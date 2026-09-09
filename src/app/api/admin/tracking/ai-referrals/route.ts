import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { aggregateAiReferrals, classifyAiReferrer, isAvailabilityDeepLink, type AiReferralRow } from '@/lib/tracking/ai-referrers'

/**
 * GET /api/admin/tracking/ai-referrals?from=&to=
 *   → { engines: AiReferralRow[], totalSessions, totalBookings, totalRevenueEuros, totalAvailabilitySessions, totalAvailabilityBookings, totalAvailabilityRevenueEuros, recentAvailabilitySessions }
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
      { key: 'chatgpt', label: 'ChatGPT', sessions: 14, visitors: 11, bookings: 1, revenueEuros: 151, availabilitySessions: 8, availabilityBookings: 1, availabilityRevenueEuros: 151 },
      { key: 'perplexity', label: 'Perplexity', sessions: 6, visitors: 5, bookings: 0, revenueEuros: 0, availabilitySessions: 4, availabilityBookings: 0, availabilityRevenueEuros: 0 },
      { key: 'gemini', label: 'Gemini', sessions: 3, visitors: 3, bookings: 0, revenueEuros: 0, availabilitySessions: 1, availabilityBookings: 0, availabilityRevenueEuros: 0 },
    ]
    const recentAvailabilitySessions = [
      {
        id: 'demo-s1',
        engine: 'ChatGPT',
        entry_page: '/cruises/amsterdam-boat-tour?date=2026-09-12&time=14:00',
        started_at: new Date(Date.now() - 3600_000 * 3).toISOString(),
        booked: true,
        revenueEuros: 151,
      },
      {
        id: 'demo-s2',
        engine: 'Perplexity',
        entry_page: '/cruises/private-boat-tour?date=2026-09-14&time=16:30',
        started_at: new Date(Date.now() - 3600_000 * 18).toISOString(),
        booked: false,
        revenueEuros: 0,
      },
      {
        id: 'demo-s3',
        engine: 'ChatGPT',
        entry_page: '/cruises/amsterdam-light-festival-cruise?date=2026-12-05&time=17:00',
        started_at: new Date(Date.now() - 3600_000 * 42).toISOString(),
        booked: false,
        revenueEuros: 0,
      },
    ]
    return apiOk({
      engines,
      totalSessions: 23,
      totalBookings: 1,
      totalRevenueEuros: 151,
      totalAvailabilitySessions: 13,
      totalAvailabilityBookings: 1,
      totalAvailabilityRevenueEuros: 151,
      recentAvailabilitySessions,
      demo: true,
    })
  }

  try {
    const supabase = createAdminClient()

    const { data: sessions, error } = await supabase
      .from('analytics_sessions')
      .select('id, visitor_id, referrer, entry_page, started_at')
      .not('referrer', 'is', null)
      .gte('started_at', from)
      .lte('started_at', to)
      .order('started_at', { ascending: false })
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

    const bookingsBySession = new Map<string, number>()
    for (const b of bookings) {
      if (b.session_id) {
        bookingsBySession.set(b.session_id, (bookingsBySession.get(b.session_id) ?? 0) + (b.stripe_amount ?? 0))
      }
    }

    const engines = aggregateAiReferrals(sessions ?? [], bookings)
    const totals = engines.reduce(
      (a, e) => ({
        sessions: a.sessions + e.sessions,
        bookings: a.bookings + e.bookings,
        revenueEuros: a.revenueEuros + e.revenueEuros,
        availabilitySessions: a.availabilitySessions + e.availabilitySessions,
        availabilityBookings: a.availabilityBookings + e.availabilityBookings,
        availabilityRevenueEuros: a.availabilityRevenueEuros + e.availabilityRevenueEuros,
      }),
      {
        sessions: 0,
        bookings: 0,
        revenueEuros: 0,
        availabilitySessions: 0,
        availabilityBookings: 0,
        availabilityRevenueEuros: 0,
      },
    )

    // Find recent availability-linked AI sessions
    const recentAvailabilitySessions: {
      id: string
      engine: string
      entry_page: string
      started_at: string | null
      booked: boolean
      revenueEuros: number
    }[] = []

    for (const s of sessions ?? []) {
      const engine = classifyAiReferrer(s.referrer)
      if (!engine) continue
      if (isAvailabilityDeepLink(s.entry_page)) {
        const revCents = bookingsBySession.get(s.id)
        recentAvailabilitySessions.push({
          id: s.id,
          engine: engine.label,
          entry_page: s.entry_page!,
          started_at: s.started_at,
          booked: revCents !== undefined,
          revenueEuros: (revCents ?? 0) / 100,
        })
        if (recentAvailabilitySessions.length >= 25) break
      }
    }

    return apiOk({
      engines,
      totalSessions: totals.sessions,
      totalBookings: totals.bookings,
      totalRevenueEuros: totals.revenueEuros,
      totalAvailabilitySessions: totals.availabilitySessions,
      totalAvailabilityBookings: totals.availabilityBookings,
      totalAvailabilityRevenueEuros: totals.availabilityRevenueEuros,
      recentAvailabilitySessions,
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
