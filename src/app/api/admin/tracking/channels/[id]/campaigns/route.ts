import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * GET /api/admin/tracking/channels/[id]/campaigns
 * Returns campaigns belonging to a channel, with aggregated metrics.
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

    const supabase = createAdminClient()

    const { data: campaigns, error } = await supabase
      .from('campaigns')
      .select('*')
      .eq('channel_id', id)
      .order('created_at', { ascending: false })

    if (error) return apiError(error.message)

    // If date range provided, enrich with metrics
    if (from && to && campaigns?.length) {
      const campaignSlugs = campaigns.map((c) => c.slug).filter(Boolean)
      const { data: sessions } = campaignSlugs.length > 0
        ? await supabase
            .from('analytics_sessions')
            .select('id, visitor_id, campaign_slug')
            .gte('started_at', from)
            .lte('started_at', to)
            .in('campaign_slug', campaignSlugs)
        : { data: [] as { id: string; visitor_id: string; campaign_slug: string | null }[] }

      const sessionIds = sessions?.map((s) => s.id) ?? []
      const { data: bookings } = sessionIds.length > 0
        ? await supabase
            .from('bookings')
            .select('id, session_id, stripe_amount')
            .in('session_id', sessionIds)
            .eq('status', 'confirmed')
        : { data: [] }

      const bookingsBySession = new Set(bookings?.map((b) => b.session_id) ?? [])

      const enriched = campaigns.map((c) => {
        const campaignSessions = sessions?.filter((s) => s.campaign_slug === c.slug) ?? []
        const uniqueUsers = new Set(
          campaignSessions.map((s) => s.visitor_id).filter((id) => !id.startsWith('anon_'))
        ).size
        const campaignBookings = campaignSessions.filter((s) => bookingsBySession.has(s.id))
        const revenue = bookings
          ?.filter((b) => campaignSessions.some((s) => s.id === b.session_id))
          .reduce((sum, b) => sum + (b.stripe_amount ?? 0), 0) ?? 0
        const investmentCents = c.investment_amount != null ? c.investment_amount * 100 : null
        const roi = investmentCents && investmentCents > 0
          ? (revenue - investmentCents) / investmentCents
          : null
        return {
          ...c,
          sessions: campaignSessions.length,
          unique_visitors: uniqueUsers,
          bookings: campaignBookings.length,
          revenue_cents: revenue,
          conversion_rate: campaignSessions.length > 0 ? campaignBookings.length / campaignSessions.length : 0,
          roi,
        }
      })

      return apiOk(enriched)
    }

    return apiOk(campaigns ?? [])
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
