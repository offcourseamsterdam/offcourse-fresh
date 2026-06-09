/**
 * Server-side Supabase query builders for tracking aggregations.
 * Used by admin API routes.
 *
 * NOTE: these queries stream rows into JS for in-process aggregation.
 * They are guarded by MAX_RANGE_DAYS to prevent unbounded table scans as
 * analytics_sessions and tracking_events grow. A future improvement is to
 * move the aggregations into Postgres RPC functions.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { FUNNEL_STEPS } from './constants'

// Hard cap: refuse date ranges wider than this to prevent runaway table scans.
const MAX_RANGE_DAYS = 90

// ── Types ──

export interface DateRange {
  from: string // ISO date string
  to: string   // ISO date string
}

export type BookingCategory = 'all' | 'private' | 'shared'

export interface OverviewKPIs {
  sessions: number
  unique_visitors: number
  anonymous_sessions: number
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
) {
  if (sessionIds.length === 0) return [] as { id: string; stripe_amount: number | null; session_id: string | null; category: string | null }[]
  let query = supabase
    .from('bookings')
    .select('id, stripe_amount, session_id, category')
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

function clampRange(range: DateRange): DateRange {
  const from = new Date(range.from)
  const to = new Date(range.to)
  const maxMs = MAX_RANGE_DAYS * 24 * 60 * 60 * 1000
  if (to.getTime() - from.getTime() > maxMs) {
    const clampedFrom = new Date(to.getTime() - maxMs)
    console.warn(`[analytics] date range clamped to ${MAX_RANGE_DAYS} days (was ${Math.round((to.getTime() - from.getTime()) / 86400000)} days)`)
    return { from: clampedFrom.toISOString(), to: range.to }
  }
  return range
}

export async function getOverviewKPIs(
  supabase: SupabaseClient,
  range: DateRange,
  category: BookingCategory = 'all',
): Promise<OverviewKPIs> {
  const safeRange = clampRange(range)
  // Current period sessions
  const { data: sessions } = await supabase
    .from('analytics_sessions')
    .select('id, visitor_id')
    .gte('started_at', safeRange.from)
    .lte('started_at', safeRange.to)

  const sessionCount = sessions?.length ?? 0
  const allVisitorIds = sessions?.map((s) => s.visitor_id) ?? []
  const uniqueVisitors = new Set(allVisitorIds.filter((id) => !id.startsWith('anon_'))).size
  const anonymousSessions = allVisitorIds.filter((id) => id.startsWith('anon_')).length

  // Current period bookings (linked to sessions)
  const sessionIds = sessions?.map((s) => s.id) ?? []
  const linkedBookings = await fetchBookings(supabase, sessionIds, category)
  let bookingCount = linkedBookings.length
  let revenueCents = linkedBookings.reduce((sum, b) => sum + (b.stripe_amount ?? 0), 0)

  // Also count bookings without session_id
  const directBookings = await fetchDirectBookings(supabase, safeRange, category)
  bookingCount += directBookings.length
  revenueCents += directBookings.reduce((sum, b) => sum + (b.stripe_amount ?? 0), 0)

  // Previous period
  const fromDate = new Date(safeRange.from)
  const toDate = new Date(safeRange.to)
  const duration = toDate.getTime() - fromDate.getTime()
  const prevFrom = new Date(fromDate.getTime() - duration).toISOString()
  const prevTo = safeRange.from

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
    anonymous_sessions: anonymousSessions,
    bookings: bookingCount,
    revenue_cents: revenueCents,
    // Bookings per unique visitor — a person who visits twice and books once counts as one converted visitor,
    // not 50% of two sessions. Industry-standard "conversion rate" for booking platforms.
    conversion_rate: uniqueVisitors > 0 ? bookingCount / uniqueVisitors : 0,
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
  const safeRange = clampRange(range)
  const { data: sessions } = await supabase
    .from('analytics_sessions')
    .select('id, started_at')
    .gte('started_at', safeRange.from)
    .lte('started_at', safeRange.to)
    .order('started_at')

  if (!sessions?.length) return []

  const sessionIds = sessions.map((s) => s.id)
  const bookings = await fetchBookings(supabase, sessionIds, category)
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
  const safeRange = clampRange(range)
  const { data: channels } = await supabase
    .from('channels')
    .select('*')
    .eq('is_active', true)
    .order('display_order')

  if (!channels?.length) return []

  const { data: sessions } = await supabase
    .from('analytics_sessions')
    .select('id, visitor_id, channel_id')
    .gte('started_at', safeRange.from)
    .lte('started_at', safeRange.to)

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
  const safeRange = clampRange(range)
  let query = supabase
    .from('tracking_events')
    .select('event_name, session_id')
    .gte('created_at', safeRange.from)
    .lte('created_at', safeRange.to)

  if (filters?.channel_id || filters?.campaign_id) {
    let sessionQuery = supabase
      .from('analytics_sessions')
      .select('id')
      .gte('started_at', safeRange.from)
      .lte('started_at', safeRange.to)

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
    let count: number
    // view_boat step merges view_boat + view_tickets (private vs shared flow)
    if (step.event === 'view_boat') {
      const boatSessions = sessionsByEvent.get('view_boat') ?? new Set()
      const ticketSessions = sessionsByEvent.get('view_tickets') ?? new Set()
      const merged = new Set([...boatSessions, ...ticketSessions])
      count = merged.size
    } else {
      count = sessionsByEvent.get(step.event)?.size ?? 0
    }
    const prevCount = i > 0 ? (() => {
      const prevStep = FUNNEL_STEPS[i - 1]
      if (prevStep.event === 'view_boat') {
        const b = sessionsByEvent.get('view_boat') ?? new Set()
        const t = sessionsByEvent.get('view_tickets') ?? new Set()
        return new Set([...b, ...t]).size
      }
      return sessionsByEvent.get(prevStep.event)?.size ?? 0
    })() : count
    return {
      event: step.event,
      label: step.label,
      count,
      drop_off_rate: prevCount > 0 && i > 0 ? 1 - count / prevCount : 0,
    }
  })
}

// ── Conversion by listing ──
//
// Server-side reliable: attributes each unique visitor to a listing by the
// cruise/book page they LANDED on (entry_page), then divides bookings (by
// listing_id) by those visitors. This is "direct-landing conversion" — visitors
// who arrived straight on a cruise page. Visitors who entered via the homepage
// and navigated to a cruise are counted under the homepage, not here (see
// getEntryFunnel for the macro homepage→cruise leak).

export interface ListingConversion {
  listing_id: string
  slug: string
  title: string
  category: string
  visitors: number
  bookings: number
  conversion_rate: number
}

/** Extract a listing slug from a path like /en/cruises/{slug} or /en/book/{slug}/checkout. */
function slugFromPath(path: string | null): string | null {
  if (!path) return null
  const m = path.match(/^\/[a-z]{2}\/(?:cruises|book)\/([^/?]+)/)
  return m ? m[1] : null
}

export async function getConversionByListing(
  supabase: SupabaseClient,
  range: DateRange,
): Promise<ListingConversion[]> {
  const safeRange = clampRange(range)
  const { data: listings } = await supabase
    .from('cruise_listings')
    .select('id, slug, title, category')
    .eq('is_archived', false)

  if (!listings?.length) return []

  // Map slug → listing meta
  const bySlug = new Map(listings.map((l) => [l.slug, l]))

  // Unique visitors per landed-on slug
  const { data: sessions } = await supabase
    .from('analytics_sessions')
    .select('visitor_id, entry_page')
    .gte('started_at', safeRange.from)
    .lte('started_at', safeRange.to)

  const visitorsBySlug = new Map<string, Set<string>>()
  for (const s of sessions ?? []) {
    const slug = slugFromPath(s.entry_page)
    if (!slug || !bySlug.has(slug)) continue
    const set = visitorsBySlug.get(slug) ?? new Set<string>()
    if (s.visitor_id) set.add(s.visitor_id)
    visitorsBySlug.set(slug, set)
  }

  // Bookings per listing_id (website + stripe_recovery, confirmed, in range)
  const { data: bookings } = await supabase
    .from('bookings')
    .select('listing_id')
    .eq('status', 'confirmed')
    .in('booking_source', ['website', 'stripe_recovery'])
    .gte('created_at', safeRange.from)
    .lte('created_at', safeRange.to)

  const bookingsByListingId = new Map<string, number>()
  for (const b of bookings ?? []) {
    if (!b.listing_id) continue
    bookingsByListingId.set(b.listing_id, (bookingsByListingId.get(b.listing_id) ?? 0) + 1)
  }

  const rows: ListingConversion[] = listings
    .map((l) => {
      const visitors = visitorsBySlug.get(l.slug)?.size ?? 0
      const bookingCount = bookingsByListingId.get(l.id) ?? 0
      return {
        listing_id: l.id,
        slug: l.slug,
        title: l.title ?? l.slug,
        category: l.category ?? '—',
        visitors,
        bookings: bookingCount,
        conversion_rate: visitors > 0 ? bookingCount / visitors : 0,
      }
    })
    // Only show listings with some signal — hide dead test listings
    .filter((r) => r.visitors > 0 || r.bookings > 0)
    .sort((a, b) => b.visitors - a.visitors)

  return rows
}

// ── Entry funnel (homepage leak) ──
//
// The macro funnel that answers "where do we lose people before booking":
//   all visitors → reached a cruise/book page → reached checkout → booked
// All stages are server-side reliable (analytics_sessions entry/exit pages +
// the bookings table), so absolute numbers are trustworthy — unlike the
// client-side tracking_events funnel which is heavily under-counted by ad blockers.

export interface EntryFunnelStage {
  key: string
  label: string
  visitors: number
  /** Fraction of the all-visitors stage (0..1). */
  pct_of_total: number
  /** Fraction lost vs the PREVIOUS stage (0..1). 0 for the first stage. */
  drop_from_prev: number
}

export async function getEntryFunnel(
  supabase: SupabaseClient,
  range: DateRange,
): Promise<EntryFunnelStage[]> {
  const safeRange = clampRange(range)
  const { data: sessions } = await supabase
    .from('analytics_sessions')
    .select('visitor_id, entry_page, exit_page')
    .gte('started_at', safeRange.from)
    .lte('started_at', safeRange.to)

  const all = new Set<string>()
  const reachedCruise = new Set<string>()
  const reachedCheckout = new Set<string>()

  const touchesCruise = (p: string | null) => !!p && (/\/cruises\//.test(p) || /\/book\//.test(p))
  const touchesCheckout = (p: string | null) => !!p && /\/book\/.+\/checkout/.test(p)

  for (const s of sessions ?? []) {
    if (!s.visitor_id) continue
    all.add(s.visitor_id)
    if (touchesCruise(s.entry_page) || touchesCruise(s.exit_page)) reachedCruise.add(s.visitor_id)
    if (touchesCheckout(s.entry_page) || touchesCheckout(s.exit_page)) reachedCheckout.add(s.visitor_id)
  }

  // Booked stage from the source-of-truth bookings table (count, not visitors).
  const { count: bookedCount } = await supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'confirmed')
    .in('booking_source', ['website', 'stripe_recovery'])
    .gte('created_at', safeRange.from)
    .lte('created_at', safeRange.to)

  const total = all.size
  const stages = [
    { key: 'visitors', label: 'All visitors', visitors: total },
    { key: 'reached_cruise', label: 'Reached a cruise page', visitors: reachedCruise.size },
    { key: 'reached_checkout', label: 'Reached checkout', visitors: reachedCheckout.size },
    { key: 'booked', label: 'Booked', visitors: bookedCount ?? 0 },
  ]

  return stages.map((s, i) => ({
    ...s,
    pct_of_total: total > 0 ? s.visitors / total : 0,
    drop_from_prev: i > 0 && stages[i - 1].visitors > 0
      ? 1 - s.visitors / stages[i - 1].visitors
      : 0,
  }))
}

// ── WhatsApp clicks ──
//
// "How often is the WhatsApp button used?" We record a `whatsapp_click` event
// (deduped client-side to once per session per source) and count it here as
// UNIQUE SESSIONS — both overall and broken down by where the tap happened
// (floating bubble / footer / chat-to-book). Like the funnel, this is
// client-side tracking, so it under-counts visitors with ad blockers and is
// not recorded before cookie consent.

export interface WhatsAppClickStats {
  /** Unique sessions in which at least one WhatsApp button was tapped. */
  total: number
  /** Unique sessions per source, highest first. */
  bySource: { source: string; sessions: number }[]
  /**
   * Unique sessions whose WhatsApp tap carried a Google Ads click id (gclid) —
   * i.e. ad clickers who contacted us on WhatsApp (whether or not they booked).
   */
  googleAdsSessions: number
}

interface WhatsAppClickRow {
  session_id: string
  metadata: { source?: string; gclid?: string } | null
}

/** Pure aggregation of whatsapp_click rows into unique-session counts. */
export function aggregateWhatsAppClicks(rows: WhatsAppClickRow[]): WhatsAppClickStats {
  const allSessions = new Set<string>()
  const sessionsBySource = new Map<string, Set<string>>()
  const googleAdsSessions = new Set<string>()

  for (const r of rows) {
    if (!r.session_id) continue
    allSessions.add(r.session_id)
    const source = r.metadata?.source || 'unknown'
    const set = sessionsBySource.get(source) ?? new Set<string>()
    set.add(r.session_id)
    sessionsBySource.set(source, set)
    if (r.metadata?.gclid) googleAdsSessions.add(r.session_id)
  }

  const bySource = Array.from(sessionsBySource.entries())
    .map(([source, set]) => ({ source, sessions: set.size }))
    .sort((a, b) => b.sessions - a.sessions)

  return { total: allSessions.size, bySource, googleAdsSessions: googleAdsSessions.size }
}

export async function getWhatsAppClicks(
  supabase: SupabaseClient,
  range: DateRange,
): Promise<WhatsAppClickStats> {
  const { data } = await supabase
    .from('tracking_events')
    .select('session_id, metadata')
    .eq('event_name', 'whatsapp_click')
    .gte('created_at', range.from)
    .lte('created_at', range.to)

  return aggregateWhatsAppClicks((data ?? []) as WhatsAppClickRow[])
}

// ── Device breakdown ──
//
// Mobile vs desktop vs tablet, with each device's funnel-to-checkout rate.
// Server-side reliable (device_type set at session init from user-agent).
// "reached_checkout" is a per-visitor flag derived from entry/exit pages.

export interface DeviceMetrics {
  device: string
  visitors: number
  reached_cruise: number
  reached_checkout: number
  /** reached_checkout / reached_cruise (0..1) — the booking-intent rate per device. */
  checkout_rate: number
}

export async function getDeviceMetrics(
  supabase: SupabaseClient,
  range: DateRange,
): Promise<DeviceMetrics[]> {
  const safeRange = clampRange(range)
  const { data: sessions } = await supabase
    .from('analytics_sessions')
    .select('visitor_id, device_type, entry_page, exit_page')
    .gte('started_at', safeRange.from)
    .lte('started_at', safeRange.to)

  const touchesCruise = (p: string | null) => !!p && (/\/cruises\//.test(p) || /\/book\//.test(p))
  const touchesCheckout = (p: string | null) => !!p && /\/book\/.+\/checkout/.test(p)

  // Per device → sets of unique visitors at each stage
  type Stage = { all: Set<string>; cruise: Set<string>; checkout: Set<string> }
  const byDevice = new Map<string, Stage>()

  for (const s of sessions ?? []) {
    if (!s.visitor_id) continue
    const device = s.device_type ?? 'unknown'
    const stage = byDevice.get(device) ?? { all: new Set(), cruise: new Set(), checkout: new Set() }
    stage.all.add(s.visitor_id)
    if (touchesCruise(s.entry_page) || touchesCruise(s.exit_page)) stage.cruise.add(s.visitor_id)
    if (touchesCheckout(s.entry_page) || touchesCheckout(s.exit_page)) stage.checkout.add(s.visitor_id)
    byDevice.set(device, stage)
  }

  return Array.from(byDevice.entries())
    .map(([device, s]) => ({
      device,
      visitors: s.all.size,
      reached_cruise: s.cruise.size,
      reached_checkout: s.checkout.size,
      checkout_rate: s.cruise.size > 0 ? s.checkout.size / s.cruise.size : 0,
    }))
    .sort((a, b) => b.visitors - a.visitors)
}
