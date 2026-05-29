import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { quarterFromDate } from '@/lib/quarters'

/**
 * GET /api/admin/finance/partners-summary
 *
 * Top-level finance view: every partner with their quarterly settlement totals.
 *
 * Buckets each booking by direction using campaign.settlement_model:
 *   - 'reseller'   → partner owes us (was 'partner_invoice' bucket)
 *   - 'affiliate'  → we owe partner  (legacy default)
 * Falls back to booking_source = 'partner_invoice' when no campaign attribution exists.
 *
 * Subtracts settled rows from partner_settlements to compute outstanding totals.
 *
 * Response shape:
 * {
 *   partners: [
 *     {
 *       id, name,
 *       quarters: [{ quarter, partnerOwesUsCents, weOwePartnerCents, bookingCount, settledPartnerOwesUs, settledWeOwePartner }]
 *       totalPartnerOwesUsCents, totalWeOwePartnerCents,
 *       outstandingPartnerOwesUsCents, outstandingWeOwePartnerCents,
 *     }
 *   ],
 *   totals: { outstandingPartnerOwesUsCents, outstandingWeOwePartnerCents }
 * }
 */
export async function GET(_req: NextRequest) {
  try {
    const supabase = createAdminClient()

    const [partnersRes, bookingsRes, settlementsRes] = await Promise.all([
      supabase.from('partners').select('id, name').order('name', { ascending: true }),
      supabase
        .from('bookings')
        .select('partner_id, booking_date, base_amount_cents, commission_amount_cents, booking_source, campaign_id, campaigns ( settlement_model )')
        .not('partner_id', 'is', null),
      supabase
        .from('partner_settlements')
        .select('partner_id, quarter, settlement_type, amount_cents'),
    ])

    if (partnersRes.error) return apiError(partnersRes.error.message)
    if (bookingsRes.error) return apiError(bookingsRes.error.message)

    type Direction = 'partner_invoice' | 'affiliate'
    function directionFor(b: { booking_source: string | null; campaigns: { settlement_model?: string } | null }): Direction {
      const model = b.campaigns?.settlement_model
      if (model === 'reseller') return 'partner_invoice'
      if (model === 'affiliate') return 'affiliate'
      return b.booking_source === 'partner_invoice' ? 'partner_invoice' : 'affiliate'
    }

    // Bucket bookings: partnerId → quarter → { partnerOwesUs, weOwe, count }
    interface QuarterAgg {
      quarter: string
      partnerOwesUsCents: number   // accrued (base - commission) for resellers
      weOwePartnerCents: number    // accrued commission for affiliates
      bookingCount: number
    }
    const byPartner: Record<string, Record<string, QuarterAgg>> = {}

    for (const b of bookingsRes.data ?? []) {
      if (!b.partner_id || !b.booking_date) continue
      const quarter = quarterFromDate(b.booking_date)
      const dir = directionFor(b as never)
      const base = Number(b.base_amount_cents ?? 0)
      const commission = Number(b.commission_amount_cents ?? 0)

      const partnerMap = byPartner[b.partner_id] ?? (byPartner[b.partner_id] = {})
      const agg = partnerMap[quarter] ?? (partnerMap[quarter] = {
        quarter, partnerOwesUsCents: 0, weOwePartnerCents: 0, bookingCount: 0,
      })
      agg.bookingCount += 1
      if (dir === 'partner_invoice') {
        agg.partnerOwesUsCents += (base - commission)
      } else {
        agg.weOwePartnerCents += commission
      }
    }

    // Index settlements: partnerId → quarter → type → amount
    const settledByKey = new Map<string, number>() // key = `${partnerId}::${quarter}::${type}`
    for (const s of settlementsRes.data ?? []) {
      if (!s.partner_id) continue
      const key = `${s.partner_id}::${s.quarter}::${s.settlement_type}`
      settledByKey.set(key, (settledByKey.get(key) ?? 0) + Number(s.amount_cents ?? 0))
    }

    // Build response
    const partners = (partnersRes.data ?? []).map(p => {
      const quartersAgg = byPartner[p.id] ?? {}
      const quarters = Object.values(quartersAgg).map(q => {
        const settledPI = settledByKey.get(`${p.id}::${q.quarter}::partner_invoice`) ?? 0
        const settledAff = settledByKey.get(`${p.id}::${q.quarter}::affiliate`) ?? 0
        return {
          ...q,
          settledPartnerOwesUsCents: settledPI,
          settledWeOwePartnerCents: settledAff,
          outstandingPartnerOwesUsCents: Math.max(0, q.partnerOwesUsCents - settledPI),
          outstandingWeOwePartnerCents: Math.max(0, q.weOwePartnerCents - settledAff),
        }
      }).sort((a, b) => (a.quarter > b.quarter ? -1 : 1))

      const totalPartnerOwesUsCents = quarters.reduce((s, q) => s + q.partnerOwesUsCents, 0)
      const totalWeOwePartnerCents = quarters.reduce((s, q) => s + q.weOwePartnerCents, 0)
      const outstandingPartnerOwesUsCents = quarters.reduce((s, q) => s + q.outstandingPartnerOwesUsCents, 0)
      const outstandingWeOwePartnerCents = quarters.reduce((s, q) => s + q.outstandingWeOwePartnerCents, 0)

      return {
        id: p.id,
        name: p.name,
        quarters,
        totalPartnerOwesUsCents,
        totalWeOwePartnerCents,
        outstandingPartnerOwesUsCents,
        outstandingWeOwePartnerCents,
      }
    })

    const totals = {
      outstandingPartnerOwesUsCents: partners.reduce((s, p) => s + p.outstandingPartnerOwesUsCents, 0),
      outstandingWeOwePartnerCents: partners.reduce((s, p) => s + p.outstandingWeOwePartnerCents, 0),
    }

    return apiOk({ partners, totals })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
