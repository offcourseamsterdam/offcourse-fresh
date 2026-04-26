import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/tracking/campaigns/[id]/metrics?from=...&to=...
 * Returns aggregate metrics for a single campaign over a date range.
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

    const { data: campaign } = await supabase
      .from('campaigns')
      .select('slug, investment_amount')
      .eq('id', id)
      .single()

    const { data: sessions } = campaign?.slug
      ? await supabase
          .from('analytics_sessions')
          .select('id, visitor_id')
          .eq('campaign_slug', campaign.slug)
          .gte('started_at', from)
          .lte('started_at', to)
      : { data: [] as { id: string; visitor_id: string }[] }

    const sessionIds = sessions?.map((s) => s.id) ?? []
    const { data: bookings } = sessionIds.length > 0
      ? await supabase
          .from('bookings')
          .select('id, session_id, stripe_amount')
          .in('session_id', sessionIds)
          .eq('status', 'confirmed')
      : { data: [] }

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
