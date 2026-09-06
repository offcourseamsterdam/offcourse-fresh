/**
 * Partner affiliate commissions as a dated obligation per quarter.
 *
 * Reuses the proven calculation from `/api/admin/finance/partners-summary`:
 * - If a booking belongs to a partner with an 'affiliate' model (we collected the full fare),
 *   Off Course owes the partner their commission.
 * - Deducts settlements from `partner_settlements` (`settlement_type = 'affiliate'`).
 * - Generates an obligation proposal for any partner + quarter where
 *   `outstandingWeOwePartnerCents > 0`.
 *
 * Quarters that are still running (e.g. current quarter) are marked as
 * `isProvisional = true` and titled with "loopt nog".
 *
 * Due date: end of the month following the quarter end (same as BTW & city tax).
 */

import { addMonths, type ISODate } from '../dates'
import { quarterFromDate } from '@/lib/quarters'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types'

export interface PartnerRow {
  id: string
  name: string
}

export interface PartnerBookingInput {
  partner_id: string | null
  booking_date: string | null
  base_amount_cents?: number | null
  commission_amount_cents: number | null
  guest_count?: number | null
  booking_source: string | null
  campaign_id?: string | null
  campaigns?: { settlement_model?: string } | null
}

export interface PartnerSettlementInput {
  partner_id: string | null
  quarter: string
  settlement_type: string
  amount_cents: number | null
}

export interface PartnerCommissionProposal {
  key: string
  partnerId: string
  partnerName: string
  quarter: string
  title: string
  amountCents: number
  dueDate: ISODate
  isProvisional: boolean
  bookingCount: number
}

export interface PartnerCommissionOptions {
  today: ISODate
  dueMonthsAfterQuarter?: number
}

function quarterEndDate(quarter: string): ISODate {
  const [yearStr, qStr] = quarter.split('-Q')
  const year = Number(yearStr)
  const q = Number(qStr)
  const endMonth = q * 3
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate()
  return `${year}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
}

function endOfMonth(date: ISODate): ISODate {
  const y = Number(date.slice(0, 4))
  const m = Number(date.slice(5, 7))
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${date.slice(0, 7)}-${String(day).padStart(2, '0')}`
}

type Direction = 'partner_invoice' | 'affiliate'

function directionFor(b: PartnerBookingInput): Direction {
  const model = b.campaigns?.settlement_model
  if (model === 'reseller') return 'partner_invoice'
  if (model === 'affiliate') return 'affiliate'
  return (b.booking_source === 'partner_invoice' || b.booking_source === 'invoice_later')
    ? 'partner_invoice' : 'affiliate'
}

/**
 * Pure. Turns partners, bookings, and settlements into a list of
 * obligation proposals for affiliate commissions owed.
 */
export function partnerCommissionObligations(
  data: {
    partners: PartnerRow[]
    bookings: PartnerBookingInput[]
    settlements: PartnerSettlementInput[]
  },
  opts: PartnerCommissionOptions,
): PartnerCommissionProposal[] {
  const dueMonths = opts.dueMonthsAfterQuarter ?? 1

  // Index partner names
  const partnerNames = new Map<string, string>()
  for (const p of data.partners) {
    partnerNames.set(p.id, p.name)
  }

  // Aggregate bookings: partnerId -> quarter -> { weOweCents, count }
  interface QuarterAgg {
    partnerId: string
    quarter: string
    weOweCents: number
    bookingCount: number
  }
  const byPartnerAndQuarter = new Map<string, QuarterAgg>()

  for (const b of data.bookings) {
    if (!b.partner_id || !b.booking_date) continue
    if (directionFor(b) !== 'affiliate') continue // Resellers owe us, not vice versa

    const comm = Number(b.commission_amount_cents ?? 0)
    if (comm <= 0) continue

    const quarter = quarterFromDate(b.booking_date)
    const mapKey = `${b.partner_id}::${quarter}`
    let agg = byPartnerAndQuarter.get(mapKey)
    if (!agg) {
      agg = { partnerId: b.partner_id, quarter, weOweCents: 0, bookingCount: 0 }
      byPartnerAndQuarter.set(mapKey, agg)
    }
    agg.weOweCents += comm
    agg.bookingCount += 1
  }

  // Index affiliate settlements: partnerId::quarter -> settledCents
  const settledMap = new Map<string, number>()
  for (const s of data.settlements) {
    if (!s.partner_id || s.settlement_type !== 'affiliate') continue
    const key = `${s.partner_id}::${s.quarter}`
    settledMap.set(key, (settledMap.get(key) ?? 0) + Number(s.amount_cents ?? 0))
  }

  const proposals: PartnerCommissionProposal[] = []

  for (const agg of byPartnerAndQuarter.values()) {
    const settled = settledMap.get(`${agg.partnerId}::${agg.quarter}`) ?? 0
    const outstanding = Math.max(0, agg.weOweCents - settled)

    if (outstanding <= 0) continue

    const end = quarterEndDate(agg.quarter)
    const isProvisional = end >= opts.today
    const partnerName = partnerNames.get(agg.partnerId) ?? 'Partner'

    proposals.push({
      key: `partner-commission:${agg.partnerId}:${agg.quarter}`,
      partnerId: agg.partnerId,
      partnerName,
      quarter: agg.quarter,
      title: isProvisional
        ? `Commissie ${partnerName} (${agg.quarter}, loopt nog)`
        : `Commissie ${partnerName} (${agg.quarter})`,
      amountCents: outstanding,
      dueDate: endOfMonth(addMonths(end, dueMonths)),
      isProvisional,
      bookingCount: agg.bookingCount,
    })
  }

  // Chronological sorting (earliest due date first, then by partner name)
  return proposals.sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate)
    return a.partnerName.localeCompare(b.partnerName)
  })
}

/**
 * Loads the raw inputs needed to compute partner commissions from Supabase.
 */
export async function loadPartnerCommissionInputs(
  supabase: SupabaseClient<Database>,
) {
  const [partnersRes, bookingsRes, settlementsRes] = await Promise.all([
    supabase.from('partners').select('id, name').order('name', { ascending: true }),
    supabase
      .from('bookings')
      .select('partner_id, booking_date, base_amount_cents, commission_amount_cents, guest_count, booking_source, campaign_id, campaigns ( settlement_model )')
      .not('partner_id', 'is', null),
    supabase
      .from('partner_settlements')
      .select('partner_id, quarter, settlement_type, amount_cents'),
  ])

  if (partnersRes.error) throw new Error(partnersRes.error.message)
  if (bookingsRes.error) throw new Error(bookingsRes.error.message)
  if (settlementsRes.error) throw new Error(settlementsRes.error.message)

  return {
    partners: (partnersRes.data ?? []) as PartnerRow[],
    bookings: (bookingsRes.data ?? []) as unknown as PartnerBookingInput[],
    settlements: (settlementsRes.data ?? []) as PartnerSettlementInput[],
  }
}
