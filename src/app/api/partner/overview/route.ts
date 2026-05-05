import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPartnerIdFromRequest } from '@/lib/partner/get-partner-id'

/**
 * GET /api/partner/overview
 *
 * Returns KPIs for the authenticated partner:
 * - total_clicks, total_unique_visitors  (all-time, across all campaigns)
 * - total_bookings, total_commission_cents (all-time confirmed bookings)
 * - commission_this_month_cents, bookings_this_month, active_campaigns (legacy)
 * - recent_bookings (last 5, no PII)
 */
export async function GET(request: NextRequest) {
  try {
    const partnerId = await getPartnerIdFromRequest(request)
    if (!partnerId) return apiError('Unauthorized', 401)

    const admin = createAdminClient()

    const now = new Date()
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`

    // Get all campaign IDs for this partner
    const { data: campaigns } = await admin
      .from('campaigns')
      .select('id, is_active')
      .eq('partner_id', partnerId)

    const campaignIds = (campaigns ?? []).map(c => c.id)
    const activeCampaigns = (campaigns ?? []).filter(c => c.is_active).length

    // Run bookings, clicks, and sessions queries in parallel
    const [bookingsRes, clicksRes, sessionsRes] = await Promise.all([
      // Confirmed bookings attributed to this partner (by partner_id OR campaign_id)
      admin
        .from('bookings')
        .select('booking_date, created_at, listing_title, guest_count, base_amount_cents, commission_amount_cents')
        .eq('status', 'confirmed')
        .or(
          campaignIds.length > 0
            ? `partner_id.eq.${partnerId},campaign_id.in.(${campaignIds.join(',')})`
            : `partner_id.eq.${partnerId}`
        )
        .order('created_at', { ascending: false }),

      // All-time click count
      campaignIds.length > 0
        ? admin.from('campaign_clicks').select('id', { count: 'exact', head: true }).in('campaign_id', campaignIds)
        : Promise.resolve({ count: 0, error: null }),

      // All-time unique visitors
      campaignIds.length > 0
        ? admin.from('analytics_sessions').select('visitor_id').in('campaign_id', campaignIds)
        : Promise.resolve({ data: [], error: null }),
    ])

    if (bookingsRes.error) return apiError(bookingsRes.error.message)

    // Deduplicate bookings (a booking might match both partner_id and campaign_id conditions)
    const seen = new Set<string>()
    const uniqueBookings: typeof bookingsRes.data = []
    for (const b of bookingsRes.data ?? []) {
      const key = `${b.booking_date}-${b.listing_title}-${b.base_amount_cents}`
      if (!seen.has(key)) { seen.add(key); uniqueBookings.push(b) }
    }

    // All-time booking totals
    let totalCommissionCents = 0
    let commissionThisMonth = 0
    let bookingsThisMonth = 0

    for (const b of uniqueBookings) {
      const commission = b.commission_amount_cents ?? 0
      totalCommissionCents += commission
      if (b.created_at && b.created_at >= monthStart) {
        commissionThisMonth += commission
        bookingsThisMonth++
      }
    }

    // All-time clicks
    const totalClicks = (clicksRes as { count: number | null }).count ?? 0

    // All-time unique visitors (distinct visitor_id)
    const visitorIds = new Set<string>()
    for (const s of (sessionsRes as { data: { visitor_id: string }[] | null }).data ?? []) {
      if (s.visitor_id) visitorIds.add(s.visitor_id)
    }

    const recentBookings = uniqueBookings.slice(0, 5).map(b => ({
      date: b.booking_date ?? '',
      cruise: b.listing_title ?? '',
      guests: b.guest_count ?? 0,
      commission_cents: b.commission_amount_cents ?? 0,
    }))

    return apiOk({
      // 4 all-time headline KPIs
      total_clicks: totalClicks,
      total_unique_visitors: visitorIds.size,
      total_bookings: uniqueBookings.length,
      total_commission_cents: totalCommissionCents,
      // Legacy / secondary
      commission_this_month_cents: commissionThisMonth,
      bookings_this_month: bookingsThisMonth,
      active_campaigns: activeCampaigns,
      recent_bookings: recentBookings,
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
