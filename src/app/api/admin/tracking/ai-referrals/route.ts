import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { aggregateAiReferrals, type AiReferralRow } from '@/lib/tracking/ai-referrers'

/**
 * GET /api/admin/tracking/ai-referrals?from=&to=
 *   → { engines: AiReferralRow[], totalSessions, totalBookings, totalRevenueEuros }
 *
 * "Did an AI assistant cite us?" — the only first-party signal for AI citations.
 * Fetches referrered sessions in range and classifies them (the classifier is the
 * source of truth; volume is small, ~500/month, so no fragile SQL wildcard filter).
 * Bookings attribute the same way the rest of the app does: bookings.session_id.
 * Dev ?demo=1 returns sample data so the UI can be reviewed before real AI traffic.
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const url = new URL(request.url)
  const to = url.searchParams.get('to') ?? new Date().toISOString()
  const from = url.searchParams.get('from') ?? new Date(Date.now() - 30 * 86_400_000).toISOString()

  if (url.searchParams.get('demo') === '1' && process.env.NODE_ENV !== 'production') {
    const engines: AiReferralRow[] = [
      { key: 'chatgpt', label: 'ChatGPT', sessions: 14, visitors: 11, bookings: 1, revenueEuros: 151 },
      { key: 'perplexity', label: 'Perplexity', sessions: 6, visitors: 5, bookings: 0, revenueEuros: 0 },
      { key: 'gemini', label: 'Gemini', sessions: 3, visitors: 3, bookings: 0, revenueEuros: 0 },
    ]
    return apiOk({ engines, totalSessions: 23, totalBookings: 1, totalRevenueEuros: 151, demo: true })
  }

  try {
    const supabase = createAdminClient()

    const { data: sessions, error } = await supabase
      .from('analytics_sessions')
      .select('id, visitor_id, referrer')
      .not('referrer', 'is', null)
      .gte('started_at', from)
      .lte('started_at', to)
    if (error) return apiError(error.message)

    const sessionIds = (sessions ?? []).map(s => s.id)
    let bookings: { session_id: string | null; stripe_amount: number | null }[] = []
    if (sessionIds.length > 0) {
      const { data } = await supabase
        .from('bookings')
        .select('session_id, stripe_amount')
        .in('session_id', sessionIds)
        .eq('status', 'confirmed')
      bookings = data ?? []
    }

    const engines = aggregateAiReferrals(sessions ?? [], bookings)
    const totals = engines.reduce(
      (a, e) => ({
        sessions: a.sessions + e.sessions,
        bookings: a.bookings + e.bookings,
        revenueEuros: a.revenueEuros + e.revenueEuros,
      }),
      { sessions: 0, bookings: 0, revenueEuros: 0 },
    )

    return apiOk({
      engines,
      totalSessions: totals.sessions,
      totalBookings: totals.bookings,
      totalRevenueEuros: totals.revenueEuros,
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
