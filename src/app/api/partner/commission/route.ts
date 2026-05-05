import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPartnerIdFromRequest } from '@/lib/partner/get-partner-id'

/**
 * GET /api/partner/commission
 *
 * Returns monthly commission aggregates for the last 12 months,
 * plus all-time totals. Only confirmed bookings are included.
 * Catches bookings via partner_id OR campaign_id ownership.
 */
export async function GET(request: NextRequest) {
  try {
    const partnerId = await getPartnerIdFromRequest(request)
    if (!partnerId) return apiError('Unauthorized', 401)

    const admin = createAdminClient()

    const { data: campaigns } = await admin
      .from('campaigns')
      .select('id')
      .eq('partner_id', partnerId)

    const campaignIds = (campaigns ?? []).map(c => c.id)

    const { data: allBookings, error } = await admin
      .from('bookings')
      .select('booking_date, base_amount_cents, commission_amount_cents')
      .eq('status', 'confirmed')
      .or(
        campaignIds.length > 0
          ? `partner_id.eq.${partnerId},campaign_id.in.(${campaignIds.join(',')})`
          : `partner_id.eq.${partnerId}`
      )

    if (error) return apiError(error.message)

    // Deduplicate
    const seen = new Set<string>()
    const bookings = []
    for (const b of allBookings ?? []) {
      const key = `${b.booking_date}-${b.base_amount_cents}`
      if (!seen.has(key)) { seen.add(key); bookings.push(b) }
    }

    // Last 12 months boundary for the breakdown
    const now = new Date()
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1)
    const cutoff = `${twelveMonthsAgo.getFullYear()}-${String(twelveMonthsAgo.getMonth() + 1).padStart(2, '0')}-01`

    const monthlyMap: Record<string, { bookings: number; base_revenue_cents: number; commission_cents: number }> = {}
    let totalBookings = 0
    let totalCommissionCents = 0

    for (const b of bookings) {
      const base = b.base_amount_cents ?? 0
      const commission = b.commission_amount_cents ?? 0
      totalBookings++
      totalCommissionCents += commission

      if (b.booking_date && b.booking_date >= cutoff) {
        const month = b.booking_date.slice(0, 7)
        if (!monthlyMap[month]) monthlyMap[month] = { bookings: 0, base_revenue_cents: 0, commission_cents: 0 }
        monthlyMap[month].bookings++
        monthlyMap[month].base_revenue_cents += base
        monthlyMap[month].commission_cents += commission
      }
    }

    const months = Object.entries(monthlyMap)
      .map(([month, data]) => ({ month, ...data }))
      .sort((a, b) => a.month.localeCompare(b.month))

    return apiOk({ total_bookings: totalBookings, total_commission_cents: totalCommissionCents, months })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
