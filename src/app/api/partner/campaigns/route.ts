import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPartnerIdFromRequest } from '@/lib/partner/get-partner-id'

/**
 * GET /api/partner/campaigns
 *
 * Returns campaigns belonging to the authenticated partner,
 * enriched with booking count and total commission earned.
 */
export async function GET(request: NextRequest) {
  try {
    const partnerId = await getPartnerIdFromRequest(request)
    if (!partnerId) return apiError('Unauthorized', 401)

    const admin = createAdminClient()

    const [campaignsRes, bookingsRes] = await Promise.all([
      admin
        .from('campaigns')
        .select('id, name, slug, listing_id, percentage_value, investment_type, is_active, created_at')
        .eq('partner_id', partnerId)
        .order('created_at', { ascending: false }),
      admin
        .from('bookings')
        .select('campaign_id, commission_amount_cents')
        .eq('partner_id', partnerId)
        .eq('status', 'confirmed')
        .not('campaign_id', 'is', null),
    ])

    if (campaignsRes.error) return apiError(campaignsRes.error.message)
    if (bookingsRes.error) return apiError(bookingsRes.error.message)

    const statsByCampaign: Record<string, { count: number; commission: number }> = {}
    for (const b of bookingsRes.data ?? []) {
      if (!b.campaign_id) continue
      const s = statsByCampaign[b.campaign_id] ?? { count: 0, commission: 0 }
      s.count++
      s.commission += b.commission_amount_cents ?? 0
      statsByCampaign[b.campaign_id] = s
    }

    const campaigns = (campaignsRes.data ?? []).map(c => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      is_active: c.is_active,
      bookings_count: statsByCampaign[c.id]?.count ?? 0,
      commission_cents: statsByCampaign[c.id]?.commission ?? 0,
    }))

    return apiOk(campaigns)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
