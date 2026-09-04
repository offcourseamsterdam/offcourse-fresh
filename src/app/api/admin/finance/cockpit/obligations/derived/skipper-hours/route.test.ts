import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseChainMock, has, op, queriesFor, type RecordedQuery } from '@/test/supabase-chain-mock'

const h = vi.hoisted(() => ({ requireAdmin: vi.fn(), createAdminClient: vi.fn() }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))

import { GET, POST } from './route'

const BASE = 'https://offcourseamsterdam.com/api/admin/finance/cockpit/obligations/derived/skipper-hours'
const STAFF_ID = '77777777-7777-4777-8777-777777777777'

const SHIFTS = [{ id: 's1', staff_id: STAFF_ID, date: '2026-08-10', start_at: '2026-08-10T10:00:00.000Z', end_at: '2026-08-10T14:00:00.000Z', status: 'completed' }]
const TIME_ENTRIES: unknown[] = []
const BONUSES: unknown[] = []
const STAFF = [{ id: STAFF_ID, name: 'Bo', hourly_rate_cents: 2_500, is_active: true }]

function db(opts: { shifts?: unknown[]; timeEntries?: unknown[]; bonuses?: unknown[]; staff?: unknown[]; insertError?: { code: string; message: string } | null } = {}) {
  const { shifts = SHIFTS, timeEntries = TIME_ENTRIES, bonuses = BONUSES, staff = STAFF, insertError = null } = opts
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'shifts') return { data: shifts }
    if (q.table === 'time_entries') return { data: timeEntries }
    if (q.table === 'extra_hours_bonuses') return { data: bonuses }
    if (q.table === 'staff') return { data: staff }
    if (q.table === 'finance_obligations') {
      if (has(q, 'insert')) {
        if (insertError) return { data: null, error: insertError }
        return { data: { id: 'ob-skip-1', ...(op(q, 'insert')!.args[0] as object) } }
      }
    }
    if (q.table === 'finance_events') return { data: null }
    return { data: null }
  })
}

const req = (method: string, body?: unknown, path = '') => new NextRequest(`${BASE}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })

describe('/api/admin/finance/cockpit/obligations/derived/skipper-hours', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
  })

  describe('GET', () => {
    it('passes the requireAdmin denial through', async () => {
      h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
      expect((await GET(req('GET'))).status).toBe(401)
    })

    it('rejects a malformed months value', async () => {
      h.createAdminClient.mockReturnValue(db().client)
      expect((await GET(req('GET', undefined, '?months=abc'))).status).toBe(400)
    })

    it('accrues 4 sailed hours at €25/h for the shift and returns the result', async () => {
      h.createAdminClient.mockReturnValue(db().client)
      const res = await GET(req('GET'))
      expect(res.status).toBe(200)
      const { data } = await res.json()
      const month = data.result.months.find((m: { staffId: string }) => m.staffId === STAFF_ID)
      expect(month).toMatchObject({ month: '2026-08', hours: 4, amountCents: 10_000, staffName: 'Bo' })
    })
  })

  describe('POST', () => {
    it('rejects an empty selections array', async () => {
      expect((await POST(req('POST', { selections: [] }))).status).toBe(400)
      expect(h.createAdminClient).not.toHaveBeenCalled()
    })

    it('confirms a month+staff accrual into a crew obligation', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await POST(req('POST', { selections: [{ month: '2026-08', staffId: STAFF_ID }] }))
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data.created).toEqual([{ key: `skipper-hours:2026-08:${STAFF_ID}`, id: 'ob-skip-1' }])

      const insertQuery = queriesFor(mock.queries, 'finance_obligations', 'insert')[0]
      expect(op(insertQuery, 'insert')!.args[0]).toMatchObject({
        title: 'Bo — uren 2026-08', kind: 'crew', amount_cents: 10_000, source_key: `skipper-hours:2026-08:${STAFF_ID}`, status: 'open',
      })
      expect(queriesFor(mock.queries, 'finance_events', 'insert')).toHaveLength(1)
    })

    it('skips a month/staff with no accrual instead of erroring', async () => {
      h.createAdminClient.mockReturnValue(db().client)
      const res = await POST(req('POST', { selections: [{ month: '2026-01', staffId: STAFF_ID }] }))
      const { data } = await res.json()
      expect(data.created).toEqual([])
      expect(data.skipped[0].reason).toMatch(/Geen opgebouwde uren/)
    })

    it('skips unpriced hours (rate of zero) rather than paying zero', async () => {
      h.createAdminClient.mockReturnValue(db({ staff: [{ id: STAFF_ID, name: 'Bo', hourly_rate_cents: 0, is_active: true }] }).client)
      const res = await POST(req('POST', { selections: [{ month: '2026-08', staffId: STAFF_ID }] }))
      const { data } = await res.json()
      expect(data.created).toEqual([])
      expect(data.skipped[0].reason).toMatch(/zonder uurtarief/)
    })

    it('is idempotent on a source_key conflict', async () => {
      h.createAdminClient.mockReturnValue(db({ insertError: { code: '23505', message: 'duplicate' } }).client)
      const res = await POST(req('POST', { selections: [{ month: '2026-08', staffId: STAFF_ID }] }))
      const { data } = await res.json()
      expect(data.created).toEqual([])
      expect(data.skipped).toEqual([{ key: `skipper-hours:2026-08:${STAFF_ID}`, reason: 'already existed' }])
    })
  })
})
