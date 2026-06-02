import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { setCampaignMarketing, removeCampaignMarketing } from '@/lib/google-ads/listings'

/**
 * POST /api/admin/google-ads/link
 * Body: { campaignId, marketingCampaignId }       — connect to a marketing campaign
 *       { campaignId, marketingCampaignId: null }  — disconnect
 *
 * The listing is NOT set here — it's derived from the marketing campaign
 * (campaigns.listing_id) and cached server-side by setCampaignMarketing.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const { campaignId, marketingCampaignId } = await request.json()
    if (!campaignId) return apiError('campaignId is required', 400)
    const supabase = createAdminClient()

    if (!marketingCampaignId) {
      const { error } = await removeCampaignMarketing(supabase, String(campaignId))
      return error ? apiError(error.message) : apiOk({ campaignId, marketingCampaignId: null })
    }

    const { error } = await setCampaignMarketing(supabase, String(campaignId), String(marketingCampaignId))
    return error ? apiError(error.message) : apiOk({ campaignId, marketingCampaignId })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
