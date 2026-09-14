import { describe, it, expect } from 'vitest'
import { aggregateWhatsAppClicks, getOverviewKPIs, getEntryFunnel, getDeviceMetrics } from './queries'
import type { SupabaseClient } from '@supabase/supabase-js'

// Minimal in-memory stand-in for the Supabase client. Applies .eq/.in/.is/.not/.gte/.lte
// as real filters over the given rows, and answers both `await query` (data) and the
// `{ count, head: true }` shape used for count-only queries.
function makeMockSupabase(tables: Record<string, Record<string, unknown>[]>): SupabaseClient {
  function makeQuery(table: string) {
    const rows = tables[table] ?? []
    const filters: Array<(r: Record<string, unknown>) => boolean> = []
    let wantCount = false
    const chain = {
      select(_cols: string, opts?: { count?: string; head?: boolean }) {
        if (opts?.count) wantCount = true
        return chain
      },
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val)
        return chain
      },
      in(col: string, vals: unknown[]) {
        filters.push((r) => vals.includes(r[col]))
        return chain
      },
      is(col: string, val: unknown) {
        filters.push((r) => (val === null ? r[col] == null : r[col] === val))
        return chain
      },
      not(col: string, op: string, val: unknown) {
        if (op === 'is' && val === null) filters.push((r) => r[col] != null)
        return chain
      },
      gte(col: string, val: unknown) {
        filters.push((r) => (r[col] as string) >= (val as string))
        return chain
      },
      lte(col: string, val: unknown) {
        filters.push((r) => (r[col] as string) <= (val as string))
        return chain
      },
      order() {
        return chain
      },
      range(from: number, to: number) {
        const filtered = rows.filter((r) => filters.every((f) => f(r)))
        return Promise.resolve({ data: filtered.slice(from, to + 1), error: null })
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        const filtered = rows.filter((r) => filters.every((f) => f(r)))
        const result = wantCount
          ? { data: null, count: filtered.length, error: null }
          : { data: filtered, error: null }
        return Promise.resolve(result).then(resolve, reject)
      },
    }
    return chain
  }
  return { from: (table: string) => makeQuery(table) } as unknown as SupabaseClient
}

describe('getOverviewKPIs — excludes platform/backfilled bookings', () => {
  const range = { from: '2026-08-04T00:00:00.000Z', to: '2026-08-10T23:59:59.999Z' }

  it('counts only website/stripe_recovery bookings toward the headline KPI, not platform or manually-backfilled rows', async () => {
    const db = makeMockSupabase({
      analytics_sessions: [{ id: 's1', visitor_id: 'v1', started_at: '2026-08-05T10:00:00.000Z' }],
      bookings: [
        // Real website checkout — should count.
        {
          id: 'b1', stripe_amount: 16500, session_id: null, category: 'private',
          created_at: '2026-08-04T12:00:00.000Z', booking_source: 'website', status: 'confirmed',
        },
        // 2026-08-04 finance backfill (phone/walk-in) — same-day bulk import of a
        // historical booking, not a live conversion. Must NOT count.
        {
          id: 'b2', stripe_amount: 21486, session_id: null, category: 'private',
          created_at: '2026-08-04T14:38:00.000Z', booking_source: 'phone_walkin', status: 'confirmed',
        },
        // Same backfill batch, BoatLocal source. Must NOT count.
        {
          id: 'b3', stripe_amount: 0, session_id: null, category: 'shared',
          created_at: '2026-08-04T12:43:00.000Z', booking_source: 'boatlocal', status: 'confirmed',
        },
      ],
    })

    const kpis = await getOverviewKPIs(db, range)
    expect(kpis.bookings).toBe(1)
    expect(kpis.revenue_cents).toBe(16500)
  })
})

describe('aggregateWhatsAppClicks', () => {
  it('returns zero for no rows', () => {
    expect(aggregateWhatsAppClicks([])).toEqual({ total: 0, bySource: [], googleAdsSessions: 0 })
  })

  it('counts unique sessions overall (deduping repeat rows from one session)', () => {
    const stats = aggregateWhatsAppClicks([
      { session_id: 's1', metadata: { source: 'floating_button' } },
      { session_id: 's1', metadata: { source: 'floating_button' } },
      { session_id: 's2', metadata: { source: 'floating_button' } },
    ])
    expect(stats.total).toBe(2)
    expect(stats.bySource).toEqual([{ source: 'floating_button', sessions: 2 }])
  })

  it('breaks down unique sessions per source, sorted by sessions desc', () => {
    const stats = aggregateWhatsAppClicks([
      { session_id: 's1', metadata: { source: 'floating_button' } },
      { session_id: 's2', metadata: { source: 'floating_button' } },
      { session_id: 's3', metadata: { source: 'floating_button' } },
      { session_id: 's1', metadata: { source: 'footer' } },
      { session_id: 's2', metadata: { source: 'footer' } },
      { session_id: 's1', metadata: { source: 'chat_to_book' } },
    ])
    expect(stats.bySource).toEqual([
      { source: 'floating_button', sessions: 3 },
      { source: 'footer', sessions: 2 },
      { source: 'chat_to_book', sessions: 1 },
    ])
  })

  it('counts a session once in the total even if it used multiple sources', () => {
    const stats = aggregateWhatsAppClicks([
      { session_id: 's1', metadata: { source: 'floating_button' } },
      { session_id: 's1', metadata: { source: 'footer' } },
    ])
    expect(stats.total).toBe(1)
    expect(stats.bySource).toHaveLength(2)
  })

  it('buckets missing/empty source under "unknown"', () => {
    const stats = aggregateWhatsAppClicks([
      { session_id: 's1', metadata: null },
      { session_id: 's2', metadata: {} },
    ])
    expect(stats.total).toBe(2)
    expect(stats.bySource).toEqual([{ source: 'unknown', sessions: 2 }])
  })

  it('ignores rows with no session_id', () => {
    const stats = aggregateWhatsAppClicks([
      { session_id: '', metadata: { source: 'footer' } },
    ])
    expect(stats).toEqual({ total: 0, bySource: [], googleAdsSessions: 0 })
  })

  it('counts unique Google Ads sessions (gclid present), deduped per session', () => {
    const stats = aggregateWhatsAppClicks([
      { session_id: 's1', metadata: { source: 'floating_button', gclid: 'abc123' } },
      { session_id: 's1', metadata: { source: 'footer', gclid: 'abc123' } }, // same session, still 1
      { session_id: 's2', metadata: { source: 'floating_button', gclid: 'def456' } },
      { session_id: 's3', metadata: { source: 'floating_button' } }, // no gclid → not an ad clicker
    ])
    expect(stats.total).toBe(3)
    expect(stats.googleAdsSessions).toBe(2)
  })

  it('does not count empty-string gclid as a Google Ads session', () => {
    const stats = aggregateWhatsAppClicks([
      { session_id: 's1', metadata: { source: 'footer', gclid: '' } },
    ])
    expect(stats.googleAdsSessions).toBe(0)
  })
})

describe('getEntryFunnel — accurate checkout-reach tracking', () => {
  const range = { from: '2026-08-01T00:00:00.000Z', to: '2026-08-07T23:59:59.999Z' }

  it('correctly counts booked visitors as having reached checkout and cruise', async () => {
    const db = makeMockSupabase({
      analytics_sessions: [
        // Visitor 1: landed on cruise, booked, exited on confirmation
        {
          id: 's1',
          visitor_id: 'v1',
          started_at: '2026-08-02T10:00:00.000Z',
          entry_page: '/en/cruises/classic-boat-tour',
          exit_page: '/en/book/classic-boat-tour/confirmation',
          reached_checkout: false,
        },
        // Visitor 2: landed on home, reached checkout with reached_checkout flag
        {
          id: 's2',
          visitor_id: 'v2',
          started_at: '2026-08-03T11:00:00.000Z',
          entry_page: '/en',
          exit_page: '/en/book/classic-boat-tour/checkout',
          reached_checkout: true,
        },
        // Visitor 3: only visited homepage
        {
          id: 's3',
          visitor_id: 'v3',
          started_at: '2026-08-04T12:00:00.000Z',
          entry_page: '/en',
          exit_page: '/en',
          reached_checkout: false,
        },
      ],
      bookings: [
        // v1 booked
        {
          id: 'b1',
          session_id: 's1',
          created_at: '2026-08-02T10:15:00.000Z',
          booking_source: 'website',
          status: 'confirmed',
        },
      ],
    })

    const stages = await getEntryFunnel(db, range)
    const stageMap = Object.fromEntries(stages.map((s) => [s.key, s]))

    // 3 total visitors
    expect(stageMap.visitors.visitors).toBe(3)
    // v1 (booked) and v2 (reached checkout) both count toward cruise
    expect(stageMap.reached_cruise.visitors).toBe(2)
    // v1 (booked) and v2 (reached_checkout=true) both count toward checkout
    expect(stageMap.reached_checkout.visitors).toBe(2)
    // 1 booking
    expect(stageMap.booked.visitors).toBe(1)
    // Drop from checkout to booked: 1 - 1/2 = 50%
    expect(stageMap.booked.drop_from_prev).toBeCloseTo(0.5)
  })
})

describe('getDeviceMetrics — booking-intent rate', () => {
  const range = { from: '2026-08-01T00:00:00.000Z', to: '2026-08-07T23:59:59.999Z' }

  it('calculates checkout rate per device using all checkout reach signals', async () => {
    const db = makeMockSupabase({
      analytics_sessions: [
        // Mobile visitor: reached checkout
        {
          id: 's_mob',
          visitor_id: 'v_mob',
          device_type: 'mobile',
          started_at: '2026-08-02T10:00:00.000Z',
          entry_page: '/en/cruises/classic-boat-tour',
          exit_page: '/en/cruises/classic-boat-tour',
          reached_checkout: true,
        },
        // Desktop visitor: booked
        {
          id: 's_desk',
          visitor_id: 'v_desk',
          device_type: 'desktop',
          started_at: '2026-08-03T11:00:00.000Z',
          entry_page: '/en/cruises/hidden-gems',
          exit_page: '/en/book/hidden-gems/confirmation',
          reached_checkout: false,
        },
      ],
      bookings: [
        {
          id: 'b_desk',
          session_id: 's_desk',
          created_at: '2026-08-03T11:20:00.000Z',
          booking_source: 'website',
          status: 'confirmed',
        },
      ],
    })

    const metrics = await getDeviceMetrics(db, range)
    const mob = metrics.find((m) => m.device === 'mobile')
    const desk = metrics.find((m) => m.device === 'desktop')

    expect(mob?.reached_cruise).toBe(1)
    expect(mob?.reached_checkout).toBe(1)
    expect(mob?.checkout_rate).toBe(1)

    expect(desk?.reached_cruise).toBe(1)
    expect(desk?.reached_checkout).toBe(1)
    expect(desk?.checkout_rate).toBe(1)
  })
})

