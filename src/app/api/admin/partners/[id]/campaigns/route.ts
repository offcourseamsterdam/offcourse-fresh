import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/partners/[id]/campaigns
 * Returns all campaigns for a partner enriched with all-time booking count and commission.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = createAdminClient()

    const [campaignsRes, bookingsRes] = await Promise.all([
      supabase
        .from('campaigns')
        .select('id, name, slug, is_active, percentage_value, investment_type, listing_id, created_at')
        .eq('partner_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('bookings')
        .select('campaign_id, commission_amount_cents')
        .eq('partner_id', id)
        .eq('status', 'confirmed')
        .not('campaign_id', 'is', null),
    ])

    if (campaignsRes.error) return apiError(campaignsRes.error.message)

    const statsByCampaign: Record<string, { count: number; commission: number }> = {}
    for (const b of bookingsRes.data ?? []) {
      if (!b.campaign_id) continue
      const s = statsByCampaign[b.campaign_id] ?? { count: 0, commission: 0 }
      s.count++
      s.commission += b.commission_amount_cents ?? 0
      statsByCampaign[b.campaign_id] = s
    }

    const campaigns = (campaignsRes.data ?? []).map(c => ({
      ...c,
      bookings_count: statsByCampaign[c.id]?.count ?? 0,
      commission_cents: statsByCampaign[c.id]?.commission ?? 0,
    }))

    return apiOk(campaigns)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
