import { describe, it, expect } from 'vitest'
import { aggregateWhatsAppClicks, getOverviewKPIs } from './queries'
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
