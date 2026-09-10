import { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  aggregateAiReferrals,
  classifyAiEngine,
  isAvailabilityDeepLink,
  type SessionRecord,
  type BookingRecord,
} from '@/lib/tracking/ai-referrers'

/**
 * GET /api/admin/tracking/ai-referrals?from=&to=
 *   → { engines: AiReferralRow[], totalSessions, totalBookings, totalRevenueEuros, ... }
 *
 * Fetches sessions that arrived via an AI engine (detected via referrer host OR utm_source),
 * plus bookings attributed via session_id OR traffic_detail (e.g. 'chatgpt.com').
 * Core 4 engines (ChatGPT, Perplexity, Gemini, Claude) always appear in the result.
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const url = new URL(request.url)
  const to = url.searchParams.get('to') ?? new Date().toISOString()
  const from = url.searchParams.get('from') ?? new Date(Date.now() - 30 * 86_400_000).toISOString()

  try {
    const supabase = createAdminClient()

    // 1. Fetch AI sessions: match by referrer host OR utm_source
    //    Removing `.not('referrer', 'is', null)` — ChatGPT links often arrive with
    //    referrer=null but utm_source='chatgpt.com' stored by our tracking code.
    const aiFilter = [
      'utm_source.ilike.%chatgpt%',
      'utm_source.ilike.%perplexity%',
      'utm_source.ilike.%gemini%',
      'utm_source.ilike.%claude%',
      'utm_source.ilike.%copilot%',
      'utm_source.ilike.%deepseek%',
      'utm_source.ilike.%grok%',
      'utm_source.ilike.%mistral%',
      'utm_source.ilike.%poe%',
      'utm_source.ilike.%meta.ai%',
      'referrer.ilike.%chatgpt.com%',
      'referrer.ilike.%chat.openai.com%',
      'referrer.ilike.%perplexity.ai%',
      'referrer.ilike.%gemini.google.com%',
      'referrer.ilike.%bard.google.com%',
      'referrer.ilike.%copilot.microsoft.com%',
      'referrer.ilike.%claude.ai%',
      'referrer.ilike.%meta.ai%',
      'referrer.ilike.%deepseek.com%',
      'referrer.ilike.%grok.com%',
      'referrer.ilike.%chat.mistral.ai%',
      'referrer.ilike.%you.com%',
      'referrer.ilike.%poe.com%',
    ].join(',')

    const { data: sessions, error } = await supabase
      .from('analytics_sessions')
      .select('id, visitor_id, referrer, utm_source, entry_page, started_at')
      .or(aiFilter)
      .gte('started_at', from)
      .lte('started_at', to)
      .order('started_at', { ascending: false })
    if (error) return apiError(error.message)

    const sessionList: SessionRecord[] = sessions ?? []
    const sessionIds = sessionList.map(s => s.id)

    // 2. Fetch bookings matching known AI session IDs OR via traffic_detail field
    const { data: rawBookings } = await supabase
      .from('bookings')
      .select('id, session_id, stripe_amount, traffic_detail, traffic_source')
      .or([
        sessionIds.length > 0 ? `session_id.in.(${sessionIds.map(id => `"${id}"`).join(',')})` : null,
        'traffic_detail.ilike.%chatgpt%',
        'traffic_detail.ilike.%perplexity%',
        'traffic_detail.ilike.%gemini%',
        'traffic_detail.ilike.%claude%',
        'traffic_detail.ilike.%copilot%',
        'traffic_detail.ilike.%deepseek%',
        'traffic_detail.ilike.%grok%',
        'traffic_detail.ilike.%mistral%',
      ].filter(Boolean).join(','))
      .in('status', ['confirmed', 'booked'])
      .gte('created_at', from)
      .lte('created_at', to)

    const bookings: BookingRecord[] = rawBookings ?? []

    // Map session_id → booking revenue (for recentAvailabilitySessions)
    const bookingsBySession = new Map<string, number>()
    for (const b of bookings) {
      if (b.session_id) {
        bookingsBySession.set(
          b.session_id,
          (bookingsBySession.get(b.session_id) ?? 0) + (b.stripe_amount ?? 0),
        )
      }
    }

    const engines = aggregateAiReferrals(sessionList, bookings, { includeCoreEngines: true })
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

    // 3. Build recentAvailabilitySessions
    const recentAvailabilitySessions: {
      id: string
      engine: string
      entry_page: string
      started_at: string | null
      booked: boolean
      revenueEuros: number
    }[] = []

    for (const s of sessionList) {
      const engine = classifyAiEngine(s)
      if (!engine) continue
      if (isAvailabilityDeepLink(s.entry_page) || isAvailabilityDeepLink(s.referrer)) {
        const revCents = bookingsBySession.get(s.id)
        recentAvailabilitySessions.push({
          id: s.id,
          engine: engine.label,
          entry_page: s.entry_page ?? s.referrer ?? '/',
          started_at: (s as { started_at?: string | null }).started_at ?? null,
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
