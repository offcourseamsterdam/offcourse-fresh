import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPartnerIdFromRequest } from '@/lib/partner/get-partner-id'

/**
 * GET /api/partner/overview
 *
 * Returns KPIs for the authenticated partner:
 * - commission_this_month, bookings_this_month, total_commission
 * - active_campaigns count
 * - recent_bookings (last 5)
 */
export async function GET(request: NextRequest) {
  try {
    const partnerId = await getPartnerIdFromRequest(request)
    if (!partnerId) return apiError('Unauthorized', 401)

    const admin = createAdminClient()

    // Current month boundaries (UTC)
    const now = new Date()
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

    // Fetch all partner bookings, campaigns in parallel
    const [bookingsRes, campaignsRes] = await Promise.all([
      admin
        .from('bookings')
        .select('booking_date, listing_title, guest_count, base_amount_cents, commission_amount_cents')
        .eq('partner_id', partnerId)
        .order('booking_date', { ascending: false }),
      admin
        .from('campaigns')
        .select('id, is_active')
        .eq('partner_id', partnerId),
    ])

    if (bookingsRes.error) return apiError(bookingsRes.error.message)
    if (campaignsRes.error) return apiError(campaignsRes.error.message)

    const bookings = bookingsRes.data ?? []
    const campaigns = campaignsRes.data ?? []

    // Compute KPIs
    let commissionThisMonth = 0
    let bookingsThisMonth = 0
    let totalCommission = 0

    for (const b of bookings) {
      const commission = b.commission_amount_cents ?? 0
      totalCommission += commission

      if (b.booking_date && b.booking_date >= monthStart) {
        commissionThisMonth += commission
        bookingsThisMonth++
      }
    }

    const activeCampaigns = campaigns.filter(c => c.is_active).length

    // Last 5 bookings (no customer PII)
    const recentBookings = bookings.slice(0, 5).map(b => ({
      listing_title: b.listing_title,
      booking_date: b.booking_date,
      guest_count: b.guest_count,
      base_amount_cents: b.base_amount_cents,
      commission_amount_cents: b.commission_amount_cents,
    }))

    return apiOk({
      commission_this_month: commissionThisMonth,
      bookings_this_month: bookingsThisMonth,
      total_commission: totalCommission,
      active_campaigns: activeCampaigns,
      recent_bookings: recentBookings,
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
