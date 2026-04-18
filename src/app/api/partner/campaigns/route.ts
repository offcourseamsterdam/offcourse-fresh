import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPartnerIdFromRequest } from '@/lib/partner/get-partner-id'

/**
 * GET /api/partner/campaigns
 *
 * Returns campaigns belonging to the authenticated partner,
 * enriched with a booking count per campaign.
 */
export async function GET(request: NextRequest) {
  try {
    const partnerId = await getPartnerIdFromRequest(request)
    if (!partnerId) return apiError('Unauthorized', 401)

    const admin = createAdminClient()

    // Fetch campaigns and bookings for this partner in parallel
    const [campaignsRes, bookingsRes] = await Promise.all([
      admin
        .from('campaigns')
        .select('id, name, slug, listing_id, percentage_value, investment_type, is_active, created_at')
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: false }),
      admin
        .from('bookings')
        .select('campaign_id')
        .eq('partner_id', partnerId)
        .not('campaign_id', 'is', null),
    ])

    if (campaignsRes.error) return apiError(campaignsRes.error.message)
    if (bookingsRes.error) return apiError(bookingsRes.error.message)

    // Count bookings per campaign
    const bookingCountByCampaign: Record<string, number> = {}
    for (const b of bookingsRes.data ?? []) {
      if (!b.campaign_id) continue
      bookingCountByCampaign[b.campaign_id] = (bookingCountByCampaign[b.campaign_id] ?? 0) + 1
    }

    const campaigns = (campaignsRes.data ?? []).map(c => ({
      ...c,
      booking_count: bookingCountByCampaign[c.id] ?? 0,
    }))

    return apiOk({ campaigns })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
