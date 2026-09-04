import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseChainMock, has, op, queriesFor, type RecordedQuery } from '@/test/supabase-chain-mock'

const h = vi.hoisted(() => ({ requireAdmin: vi.fn(), createAdminClient: vi.fn() }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))

import { GET, POST } from './route'

const BASE = 'https://offcourseamsterdam.com/api/admin/finance/cockpit/obligations/derived/city-tax'

// 300 guests in Q1 2026, well past a small free allowance, so Q1 is taxable and closed
// (accrueCityTax's own math is already unit-tested elsewhere; here it just has to produce
// a non-empty, plausible proposal so the route's plumbing can be exercised).
const BOOKING_ROWS = [
  { id: 'b1', booking_uuid: 'u1', booking_date: '2026-01-15', guest_count: 300, status: 'confirmed', booking_source: 'website' },
]

function db(bookingRows: typeof BOOKING_ROWS = BOOKING_ROWS, insertError: { code: string; message: string } | null = null) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'bookings') return { data: bookingRows }
    if (q.table === 'finance_obligations') {
      if (has(q, 'insert')) {
        if (insertError) return { data: null, error: insertError }
        return { data: { id: 'ob-1', ...(op(q, 'insert')!.args[0] as object) } }
      }
    }
    if (q.table === 'finance_events') return { data: null }
    return { data: null }
  })
}

const req = (method: string, body?: unknown, path = '') => new NextRequest(`${BASE}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })

describe('/api/admin/finance/cockpit/obligations/derived/city-tax', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
  })

  describe('GET', () => {
    it('passes the requireAdmin denial through', async () => {
      h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
      expect((await GET(req('GET'))).status).toBe(401)
    })

    it('rejects a malformed year', async () => {
      h.createAdminClient.mockReturnValue(db().client)
      expect((await GET(req('GET', undefined, '?year=abc'))).status).toBe(400)
      expect((await GET(req('GET', undefined, '?year=26'))).status).toBe(400)
    })

    it('scopes the bookings query to the requested year and returns accrual + proposals', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await GET(req('GET', undefined, '?year=2026'))
      expect(res.status).toBe(200)
      const bookingsQuery = mock.queries.find(q => q.table === 'bookings')!
      expect(op(bookingsQuery, 'gte')?.args).toEqual(['booking_date', '2026-01-01'])
      expect(op(bookingsQuery, 'lte')?.args).toEqual(['booking_date', '2026-12-31'])
      const { data } = await res.json()
      expect(data.accrual.quarters).toHaveLength(4)
      expect(data.proposals.length).toBeGreaterThan(0)
      expect(data.proposals[0].key).toMatch(/^city-tax:2026-Q\d$/)
    })
  })

  describe('POST', () => {
    it('passes the requireAdmin denial through', async () => {
      h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
      expect((await POST(req('POST', { keys: ['city-tax:2026-Q1'] }))).status).toBe(401)
    })

    it('rejects an empty keys array', async () => {
      expect((await POST(req('POST', { keys: [] }))).status).toBe(400)
      expect(h.createAdminClient).not.toHaveBeenCalled()
    })

    it('confirms a known proposal and logs obligation_created with the amount as delta', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      const getRes = await GET(req('GET', undefined, '?year=2026'))
      const { data: getData } = await getRes.json()
      const key = getData.proposals[0].key

      const res = await POST(req('POST', { keys: [key] }))
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data.created).toEqual([{ key, id: 'ob-1' }])
      expect(data.skipped).toEqual([])

      const insertQuery = queriesFor(mock.queries, 'finance_obligations', 'insert')[0]
      expect(op(insertQuery, 'insert')!.args[0]).toMatchObject({ kind: 'tax', source_key: key, notes: 'Toeristenbelasting, automatisch berekend', status: 'open' })
      const eventQuery = queriesFor(mock.queries, 'finance_events', 'insert')[0]
      expect(op(eventQuery, 'insert')!.args[0]).toMatchObject({ event_type: 'obligation_created', delta_cents: expect.any(Number) })
    })

    it('skips an unknown key without erroring', async () => {
      h.createAdminClient.mockReturnValue(db().client)
      const res = await POST(req('POST', { keys: ['city-tax:2026-Q4'] }))
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data.created).toEqual([])
      expect(data.skipped).toEqual([{ key: 'city-tax:2026-Q4', reason: 'Onbekende of niet meer geldige sleutel' }])
    })

    it('is idempotent: a source_key conflict is reported as skipped, not an error', async () => {
      const mock = db(BOOKING_ROWS, { code: '23505', message: 'duplicate key' })
      h.createAdminClient.mockReturnValue(mock.client)
      const getRes = await GET(req('GET', undefined, '?year=2026'))
      const { data: getData } = await getRes.json()
      const key = getData.proposals[0].key

      const res = await POST(req('POST', { keys: [key] }))
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data.created).toEqual([])
      expect(data.skipped).toEqual([{ key, reason: 'already existed' }])
    })
  })
})
