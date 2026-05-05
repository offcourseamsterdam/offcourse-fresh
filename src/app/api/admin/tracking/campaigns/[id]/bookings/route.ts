import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/tracking/campaigns/[id]/bookings?from=...&to=...
 * Returns recent confirmed bookings attributed to this campaign.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const { searchParams } = request.nextUrl
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    if (!from || !to) return apiError('Missing from/to', 400)

    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from('bookings')
      .select('id, created_at, booking_date, start_time, listing_title, stripe_amount, commission_amount_cents')
      .eq('campaign_id', id)
      .eq('status', 'confirmed')
      .gte('created_at', from)
      .lte('created_at', to)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) return apiError(error.message)
    return apiOk(data ?? [])
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
