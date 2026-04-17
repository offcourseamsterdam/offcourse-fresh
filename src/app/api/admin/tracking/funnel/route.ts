import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'
import { getFunnelData } from '@/lib/tracking/queries'

/**
 * GET /api/admin/tracking/funnel?from=...&to=...&channel_id=...&campaign_id=...
 *
 * Returns funnel step data with drop-off rates.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const channel_id = searchParams.get('channel_id') ?? undefined
    const campaign_id = searchParams.get('campaign_id') ?? undefined

    if (!from || !to) {
      return apiError('Missing from/to date parameters', 400)
    }

    const supabase = createAdminClient()
    const funnel = await getFunnelData(supabase, { from, to }, { channel_id, campaign_id })

    return apiOk(funnel)
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
