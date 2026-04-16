/**
 * Server-side Supabase query builders for tracking aggregations.
 * Used by admin API routes.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { FUNNEL_STEPS } from './constants'

// ── Types ──

export interface DateRange {
  from: string // ISO date string
  to: string   // ISO date string
}

export type BookingCategory = 'all' | 'private' | 'shared'

export interface OverviewKPIs {
  sessions: number
  unique_visitors: number
  bookings: number
  revenue_cents: number
  conversion_rate: number
  prev_sessions: number
  prev_bookings: number
  prev_revenue_cents: number
}

export interface TrafficByDay {
  date: string
  sessions: number
  bookings: number
}

export interface ChannelMetrics {
  id: string
  name: string
  slug: string
  color: string | null
  icon: string | null
  sessions: number
  unique_visitors: number
  bookings: number
  revenue_cents: number
  conversion_rate: number
}

export interface FunnelStep {
  event: string
  label: string
  count: number
  drop_off_rate: number
}

// ── Helper: fetch bookings with optional category filter ──

async function fetchBookings(
  supabase: SupabaseClient,
  sessionIds: string[],
  category: BookingCategory,
  fields = 'id, stripe_amount, session_id, category',
) {
  if (sessionIds.length === 0) return []
  let query = supabase
    .from('bookings')
    .select(fields)
    .in('session_id', sessionIds)
    .eq('status', 'confirmed')
  if (category !== 'all') query = query.eq('category', category)
  const { data } = await query
  return data ?? []
}

async function fetchDirectBookings(
  supabase: SupabaseClient,
  range: DateRange,
  category: BookingCategory,
) {
  let query = supabase
    .from('bookings')
    .select('id, stripe_amount, category')
    .is('session_id', null)
    .gte('created_at', range.from)
    .lte('created_at', range.to)
    .eq('status', 'confirmed')
  if (category !== 'all') query = query.eq('category', category)
  const { data } = await query
  return data ?? []
}

// ── Overview KPIs ──

export async function getOverviewKPIs(
  supabase: SupabaseClient,
  range: DateRange,
  category: BookingCategory = 'all',
): Promise<OverviewKPIs> {
  // Current period sessions
  const { data: sessions } = await supabase
    .from('analytics_sessions')
    .select('id, visitor_id')
    .gte('started_at', range.from)
    .lte('started_at', range.to)

  const sessionCount = sessions?.length ?? 0
  const uniqueVisitors = new Set(sessions?.map((s) => s.visitor_id) ?? []).size

  // Current period bookings (linked to sessions)
  const sessionIds = sessions?.map((s) => s.id) ?? []
  const linkedBookings = await fetchBookings(supabase, sessionIds, category)
  let bookingCount = linkedBookings.length
  let revenueCents = linkedBookings.reduce((sum, b) => sum + (b.stripe_amount ?? 0), 0)

  // Also count bookings without session_id
  const directBookings = await fetchDirectBookings(supabase, range, category)
  bookingCount += directBookings.length
  revenueCents += directBookings.reduce((sum, b) => sum + (b.stripe_amount ?? 0), 0)

  // Previous period
  const fromDate = new Date(range.from)
  const toDate = new Date(range.to)
  const duration = toDate.getTime() - fromDate.getTime()
  const prevFrom = new Date(fromDate.getTime() - duration).toISOString()
  const prevTo = range.from

  const { data: prevSessions } = await supabase
    .from('analytics_sessions')
    .select('id')
    .gte('started_at', prevFrom)
    .lte('started_at', prevTo)

  const prevSessionIds = prevSessions?.map((s) => s.id) ?? []
  const prevLinkedBookings = await fetchBookings(supabase, prevSessionIds, category)
  const prevBookingCount = prevLinkedBookings.length
  const prevRevenueCents = prevLinkedBookings.reduce((sum, b) => sum + (b.stripe_amount ?? 0), 0)

  return {
    sessions: sessionCount,
    unique_visitors: uniqueVisitors,
    bookings: bookingCount,
    revenue_cents: revenueCents,
    conversion_rate: sessionCount > 0 ? bookingCount / sessionCount : 0,
    prev_sessions: prevSessions?.length ?? 0,
    prev_bookings: prevBookingCount,
    prev_revenue_cents: prevRevenueCents,
  }
}

// ── Traffic by day ──

export async function getTrafficByDay(
  supabase: SupabaseClient,
  range: DateRange,
  category: BookingCategory = 'all',
): Promise<TrafficByDay[]> {
  const { data: sessions } = await supabase
    .from('analytics_sessions')
    .select('id, started_at')
    .gte('started_at', range.from)
    .lte('started_at', range.to)
    .order('started_at')

  if (!sessions?.length) return []

  const sessionIds = sessions.map((s) => s.id)
  const bookings = await fetchBookings(supabase, sessionIds, category, 'id, session_id, created_at, category')
  const bookingSessionIds = new Set(bookings.map((b) => b.session_id))

  const byDay = new Map<string, { sessions: number; bookings: number }>()
  for (const s of sessions) {
    const day = s.started_at?.slice(0, 10) ?? ''
    if (!day) continue
    const entry = byDay.get(day) ?? { sessions: 0, bookings: 0 }
    entry.sessions++
    if (bookingSessionIds.has(s.id)) entry.bookings++
    byDay.set(day, entry)
  }

  return Array.from(byDay.entries())
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ── Channel metrics ──

export async function getChannelMetrics(
  supabase: SupabaseClient,
  range: DateRange,
  category: BookingCategory = 'all',
): Promise<ChannelMetrics[]> {
  const { data: channels } = await supabase
    .from('channels')
    .select('*')
    .eq('is_active', true)
    .order('display_order')

  if (!channels?.length) return []

  const { data: sessions } = await supabase
    .from('analytics_sessions')
    .select('id, visitor_id, channel_id')
    .gte('started_at', range.from)
    .lte('started_at', range.to)

  const sessionIds = sessions?.map((s) => s.id) ?? []
  const bookings = await fetchBookings(supabase, sessionIds, category)
  const bookingsBySession = new Map<string, number>()
  for (const b of bookings) {
    if (b.session_id) bookingsBySession.set(b.session_id, b.stripe_amount ?? 0)
  }

  return channels.map((ch) => {
    const chSessions = sessions?.filter((s) => s.channel_id === ch.id) ?? []
    const chVisitors = new Set(chSessions.map((s) => s.visitor_id))
    let chBookings = 0
    let chRevenue = 0
    for (const s of chSessions) {
      if (bookingsBySession.has(s.id)) {
        chBookings++
        chRevenue += bookingsBySession.get(s.id) ?? 0
      }
    }
    return {
      id: ch.id,
      name: ch.name,
      slug: ch.slug,
      color: ch.color,
      icon: ch.icon,
      sessions: chSessions.length,
      unique_visitors: chVisitors.size,
      bookings: chBookings,
      revenue_cents: chRevenue,
      conversion_rate: chSessions.length > 0 ? chBookings / chSessions.length : 0,
    }
  })
}

// ── Funnel data ──

export async function getFunnelData(
  supabase: SupabaseClient,
  range: DateRange,
  filters?: { channel_id?: string; campaign_id?: string },
): Promise<FunnelStep[]> {
  let query = supabase
    .from('tracking_events')
    .select('event_name, session_id')
    .gte('created_at', range.from)
    .lte('created_at', range.to)

  if (filters?.channel_id || filters?.campaign_id) {
    let sessionQuery = supabase
      .from('analytics_sessions')
      .select('id')
      .gte('started_at', range.from)
      .lte('started_at', range.to)

    if (filters.channel_id) {
      sessionQuery = sessionQuery.eq('channel_id', filters.channel_id)
    }
    if (filters.campaign_id) {
      sessionQuery = sessionQuery.eq('campaign_slug', filters.campaign_id)
    }

    const { data: filteredSessions } = await sessionQuery
    const ids = filteredSessions?.map((s) => s.id) ?? []
    if (ids.length === 0) {
      return FUNNEL_STEPS.map((step) => ({
        event: step.event,
        label: step.label,
        count: 0,
        drop_off_rate: 0,
      }))
    }
    query = query.in('session_id', ids)
  }

  const { data: events } = await query

  const sessionsByEvent = new Map<string, Set<string>>()
  for (const e of events ?? []) {
    const set = sessionsByEvent.get(e.event_name) ?? new Set()
    set.add(e.session_id)
    sessionsByEvent.set(e.event_name, set)
  }

  return FUNNEL_STEPS.map((step, i) => {
    const count = sessionsByEvent.get(step.event)?.size ?? 0
    const prevCount = i > 0 ? (sessionsByEvent.get(FUNNEL_STEPS[i - 1].event)?.size ?? 0) : count
    return {
      event: step.event,
      label: step.label,
      count,
      drop_off_rate: prevCount > 0 && i > 0 ? 1 - count / prevCount : 0,
    }
  })
}
