import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPartnerIdFromRequest } from '@/lib/partner/get-partner-id'

/**
 * GET /api/partner/overview
 *
 * Returns KPIs for the authenticated partner:
 * - commission_this_month_cents, bookings_this_month, active_campaigns
 * - recent_bookings (last 5, no PII)
 */
export async function GET(request: NextRequest) {
  try {
    const partnerId = await getPartnerIdFromRequest(request)
    if (!partnerId) return apiError('Unauthorized', 401)

    const admin = createAdminClient()

    const now = new Date()
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

    // Get all campaign IDs for this partner so we can catch bookings
    // where campaign_id is set but partner_id was not populated
    const { data: campaigns } = await admin
      .from('campaigns')
      .select('id, is_active')
      .eq('partner_id', partnerId)

    const campaignIds = (campaigns ?? []).map(c => c.id)
    const activeCampaigns = (campaigns ?? []).filter(c => c.is_active).length

    // Fetch confirmed bookings attributed to this partner (by partner_id OR campaign_id)
    const { data: bookings, error: bookingsError } = await admin
      .from('bookings')
      .select('booking_date, created_at, listing_title, guest_count, base_amount_cents, commission_amount_cents')
      .eq('status', 'confirmed')
      .or(
        campaignIds.length > 0
          ? `partner_id.eq.${partnerId},campaign_id.in.(${campaignIds.join(',')})`
          : `partner_id.eq.${partnerId}`
      )
      .order('created_at', { ascending: false })

    if (bookingsError) return apiError(bookingsError.message)

    // Deduplicate (a booking might match both conditions)
    const seen = new Set<string>()
    const uniqueBookings: typeof bookings = []
    for (const b of bookings ?? []) {
      const key = `${b.booking_date}-${b.listing_title}-${b.base_amount_cents}`
      if (!seen.has(key)) { seen.add(key); uniqueBookings.push(b) }
    }

    let commissionThisMonth = 0
    let bookingsThisMonth = 0

    for (const b of uniqueBookings) {
      const commission = b.commission_amount_cents ?? 0
      if (b.created_at && b.created_at >= monthStart) {
        commissionThisMonth += commission
        bookingsThisMonth++
      }
    }

    const recentBookings = uniqueBookings.slice(0, 5).map(b => ({
      date: b.booking_date ?? '',
      cruise: b.listing_title ?? '',
      guests: b.guest_count ?? 0,
      commission_cents: b.commission_amount_cents ?? 0,
    }))

    return apiOk({
      commission_this_month_cents: commissionThisMonth,
      bookings_this_month: bookingsThisMonth,
      active_campaigns: activeCampaigns,
      recent_bookings: recentBookings,
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
