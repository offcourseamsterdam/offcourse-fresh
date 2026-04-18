import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPartnerIdFromRequest } from '@/lib/partner/get-partner-id'

/**
 * GET /api/partner/commission
 *
 * Returns monthly commission aggregates for the last 12 months,
 * plus all-time totals. Only confirmed bookings are included.
 */
export async function GET(request: NextRequest) {
  try {
    const partnerId = await getPartnerIdFromRequest(request)
    if (!partnerId) return apiError('Unauthorized', 401)

    const admin = createAdminClient()

    // Last 12 months boundary
    const now = new Date()
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1)
    const cutoff = `${twelveMonthsAgo.getFullYear()}-${String(twelveMonthsAgo.getMonth() + 1).padStart(2, '0')}-01`

    // Fetch confirmed bookings for this partner
    const { data: bookings, error } = await admin
      .from('bookings')
      .select('booking_date, base_amount_cents, commission_amount_cents')
      .eq('partner_id', partnerId)
      .eq('status', 'confirmed')

    if (error) return apiError(error.message)

    // Aggregate by month
    const monthlyMap: Record<string, { booking_count: number; total_base_cents: number; total_commission_cents: number }> = {}
    let allTimeBookings = 0
    let allTimeBaseCents = 0
    let allTimeCommissionCents = 0

    for (const b of bookings ?? []) {
      const base = b.base_amount_cents ?? 0
      const commission = b.commission_amount_cents ?? 0

      allTimeBookings++
      allTimeBaseCents += base
      allTimeCommissionCents += commission

      // Only include in monthly breakdown if within last 12 months
      if (b.booking_date && b.booking_date >= cutoff) {
        const month = b.booking_date.slice(0, 7) // YYYY-MM
        if (!monthlyMap[month]) {
          monthlyMap[month] = { booking_count: 0, total_base_cents: 0, total_commission_cents: 0 }
        }
        monthlyMap[month].booking_count++
        monthlyMap[month].total_base_cents += base
        monthlyMap[month].total_commission_cents += commission
      }
    }

    // Build sorted monthly array (ascending by month)
    const months = Object.entries(monthlyMap)
      .map(([month, data]) => ({ month, ...data }))
      .sort((a, b) => a.month.localeCompare(b.month))

    return apiOk({
      months,
      all_time: {
        booking_count: allTimeBookings,
        total_base_cents: allTimeBaseCents,
        total_commission_cents: allTimeCommissionCents,
      },
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
