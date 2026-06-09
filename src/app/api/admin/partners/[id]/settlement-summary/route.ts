import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { quarterFromDate, currentQuarter } from '@/lib/quarters'

interface RouteParams {
  params: Promise<{ id: string }>
}

interface QuarterTotals {
  quarter: string
  bookingCount: number
  baseAmountCents: number
  commissionAmountCents: number
  /** What admin owes this partner (affiliate) OR partner owes Off Course (partner_invoice) */
  netAmountCents: number
  /** Whether a row exists in partner_settlements for this (quarter, type) */
  settled: boolean
  settledAt: string | null
  paidAmountCents: number | null
  settlementId: string | null
}

interface SettlementSummary {
  partnerInvoice: QuarterTotals[]
  affiliate: QuarterTotals[]
}

/**
 * GET /api/admin/partners/[id]/settlement-summary
 *
 * Aggregates this partner's bookings by quarter and settlement type, then
 * merges in any existing partner_settlements rows so the admin can see
 * outstanding vs settled at a glance.
 *
 * Quarter is computed from booking_date (cruise date), not created_at.
 */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const denied = await requireAdmin()
  if (denied) return denied
  const { id } = await params
  const supabase = createAdminClient()

  // Pull all bookings attributed to this partner (either via partner_id or via
  // a partner-invoice listing's required_partner_id resolved at booking time).
  // Join campaigns so we can read the settlement_model that determines bucket direction.
  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('booking_date, base_amount_cents, commission_amount_cents, guest_count, booking_source, campaign_id, campaigns ( settlement_model )')
    .eq('partner_id', id)

  if (error) return apiError(error.message)

  const { data: settlements } = await supabase
    .from('partner_settlements')
    .select('id, quarter, settlement_type, amount_cents, paid_at')
    .eq('partner_id', id)

  // Determine bucket direction:
  //  - If the booking has a linked campaign, trust its settlement_model.
  //    'reseller' → partner_invoice direction (partner collected, owes us)
  //    'affiliate' → affiliate direction (we collected, owe partner)
  //  - Fallback (no campaign on the booking): use booking_source as the legacy signal.
  function directionFor(b: { booking_source: string | null; campaigns: { settlement_model?: string } | null }): 'partner_invoice' | 'affiliate' {
    const campaignModel = b.campaigns?.settlement_model
    if (campaignModel === 'reseller') return 'partner_invoice'
    if (campaignModel === 'affiliate') return 'affiliate'
    return b.booking_source === 'partner_invoice' ? 'partner_invoice' : 'affiliate'
  }

  const CITY_TAX_CENTS_PER_GUEST = 260 // €2.60 per guest — municipal pass-through

  // Bucket bookings by (quarter, type)
  const buckets: Record<string, { quarter: string; type: 'partner_invoice' | 'affiliate'; count: number; base: number; commission: number; cityTax: number }> = {}
  for (const b of bookings ?? []) {
    if (!b.booking_date) continue
    const quarter = quarterFromDate(b.booking_date)
    const type = directionFor(b as never)
    const key = `${quarter}::${type}`
    const bucket = buckets[key] ?? { quarter, type, count: 0, base: 0, commission: 0, cityTax: 0 }
    bucket.count += 1
    bucket.base += Number(b.base_amount_cents ?? 0)
    bucket.commission += Number(b.commission_amount_cents ?? 0)
    // City tax is invoiced on top for They Collect (reseller) partners —
    // they owe us the cruise net + the municipal city tax their customers paid.
    bucket.cityTax += Number(b.guest_count ?? 0) * CITY_TAX_CENTS_PER_GUEST
    buckets[key] = bucket
  }

  const settlementByKey = new Map<string, { id: string; amount_cents: number; paid_at: string }>()
  for (const s of settlements ?? []) {
    settlementByKey.set(`${s.quarter}::${s.settlement_type}`, {
      id: s.id,
      amount_cents: s.amount_cents,
      paid_at: s.paid_at,
    })
  }

  const nowQuarter = currentQuarter()

  function build(type: 'partner_invoice' | 'affiliate'): QuarterTotals[] {
    const rows: QuarterTotals[] = []
    for (const bucket of Object.values(buckets)) {
      if (bucket.type !== type) continue
      const settlement = settlementByKey.get(`${bucket.quarter}::${type}`)
      const netAmountCents =
        type === 'partner_invoice'
          ? bucket.base - bucket.commission + bucket.cityTax  // cruise net + city tax
          : bucket.commission
      rows.push({
        quarter: bucket.quarter,
        bookingCount: bucket.count,
        baseAmountCents: bucket.base,
        commissionAmountCents: bucket.commission,
        netAmountCents,
        settled: !!settlement,
        settledAt: settlement?.paid_at ?? null,
        paidAmountCents: settlement?.amount_cents ?? null,
        settlementId: settlement?.id ?? null,
      })
    }
    // Always include an "in progress" current-quarter row, even if no bookings yet.
    if (!rows.some((r) => r.quarter === nowQuarter) && type === 'partner_invoice' && Object.values(buckets).some((b) => b.type === type)) {
      rows.push({
        quarter: nowQuarter,
        bookingCount: 0,
        baseAmountCents: 0,
        commissionAmountCents: 0,
        netAmountCents: 0,
        settled: false,
        settledAt: null,
        paidAmountCents: null,
        settlementId: null,
      })
    }
    rows.sort((a, b) => (a.quarter > b.quarter ? -1 : 1))
    return rows
  }

  const summary: SettlementSummary = {
    partnerInvoice: build('partner_invoice'),
    affiliate: build('affiliate'),
  }
  return apiOk(summary)
}
