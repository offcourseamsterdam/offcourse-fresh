import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { slugify } from '@/lib/utils'

/**
 * GET /api/admin/tracking/campaigns/[id]/links
 * Returns tracking links for a campaign.
 *
 * POST /api/admin/tracking/campaigns/[id]/links
 * Creates a new tracking link.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('campaign_links')
      .select('*, campaign_clicks(count)')
      .eq('campaign_id', id)
      .order('created_at', { ascending: false })

    if (error) return apiError(error.message)
    return apiOk(data ?? [])
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { name, destination_url, partner_id, commission_type, commission_percentage, fixed_commission_amount } = body

    if (!name || !destination_url || !partner_id) {
      return apiError('Name, destination_url, and partner_id are required', 400)
    }

    const supabase = createAdminClient()
    const slug = slugify(name) + '-' + Date.now().toString(36)

    const { data, error } = await supabase
      .from('campaign_links')
      .insert({
        name,
        slug,
        destination_url,
        partner_id,
        campaign_id: id,
        commission_type: commission_type ?? 'percentage',
        commission_percentage: commission_percentage ?? null,
        fixed_commission_amount: fixed_commission_amount ?? null,
      })
      .select()
      .single()

    if (error) return apiError(error.message)
    return apiOk(data, 201)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
