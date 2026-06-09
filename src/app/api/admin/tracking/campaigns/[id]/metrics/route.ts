import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/tracking/campaigns/[id]/metrics?from=...&to=...
 * Returns aggregate metrics for a single campaign over a date range.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const { searchParams } = request.nextUrl
    const from = searchParams.get('from')
    const to = searchParams.get('to')

    if (!from || !to) return apiError('Missing from/to', 400)

    const supabase = createAdminClient()

    const { data: campaign } = await supabase
      .from('campaigns')
      .select('slug, investment_amount')
      .eq('id', id)
      .single()

    // Sessions: traffic signal — filtered by session start date
    const { data: sessions } = campaign?.slug
      ? await supabase
          .from('analytics_sessions')
          .select('id, visitor_id')
          .eq('campaign_slug', campaign.slug)
          .gte('started_at', from)
          .lte('started_at', to)
      : { data: [] as { id: string; visitor_id: string }[] }

    // Bookings: use campaign_id (server-side attribution) filtered by booking creation date.
    // This is the reliable source — set from the oc_attr cookie at checkout, never
    // contaminated by which session happened to be active in the same browser tab.
    const { data: bookings } = await supabase
      .from('bookings')
      .select('id, stripe_amount')
      .eq('campaign_id', id)
      .eq('status', 'confirmed')
      .eq('payment_status', 'paid')
      .gte('created_at', from)
      .lte('created_at', to)

    const sessionCount = sessions?.length ?? 0
    const uniqueVisitors = new Set(
      sessions?.map((s) => s.visitor_id).filter((v) => !v.startsWith('anon_')) ?? []
    ).size
    const bookingCount = bookings?.length ?? 0
    const revenueCents = bookings?.reduce((sum, b) => sum + (b.stripe_amount ?? 0), 0) ?? 0
    const conversionRate = sessionCount > 0 ? bookingCount / sessionCount : 0

    const investmentCents = campaign?.investment_amount != null ? campaign.investment_amount * 100 : null
    const roi = investmentCents && investmentCents > 0
      ? (revenueCents - investmentCents) / investmentCents
      : null

    return apiOk({ sessions: sessionCount, unique_visitors: uniqueVisitors, bookings: bookingCount, revenue_cents: revenueCents, conversion_rate: conversionRate, roi })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
