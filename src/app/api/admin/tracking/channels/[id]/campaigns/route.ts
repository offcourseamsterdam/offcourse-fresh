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
      const { data: sessions } = await supabase
        .from('analytics_sessions')
        .select('id, campaign_slug')
        .gte('started_at', from)
        .lte('started_at', to)
        .eq('channel_id', id)

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
        const campaignBookings = campaignSessions.filter((s) => bookingsBySession.has(s.id))
        const revenue = bookings
          ?.filter((b) => campaignSessions.some((s) => s.id === b.session_id))
          .reduce((sum, b) => sum + (b.stripe_amount ?? 0), 0) ?? 0
        return {
          ...c,
          sessions: campaignSessions.length,
          bookings: campaignBookings.length,
          revenue_cents: revenue,
          conversion_rate: campaignSessions.length > 0 ? campaignBookings.length / campaignSessions.length : 0,
        }
      })

      return apiOk(enriched)
    }

    return apiOk(campaigns ?? [])
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
