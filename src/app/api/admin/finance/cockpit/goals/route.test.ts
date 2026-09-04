import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseChainMock, has, op, opArg, queriesFor, type RecordedQuery } from '@/test/supabase-chain-mock'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminClient: vi.fn(),
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))

import { GET, POST } from './route'
import { PUT, DELETE } from './[id]/route'
import { POST as COMPLETE } from './[id]/complete/route'

const ID = '33333333-3333-4333-8333-333333333333'
const BASE = 'https://offcourseamsterdam.com/api/admin/finance/cockpit/goals'
const ROW = {
  id: ID,
  name: 'Nieuwe motor Diana',
  description: null,
  target_cents: 1_500_000,
  funded_cents: 640_000,
  deadline: '2027-03-01',
  priority: 2,
  monthly_funding_cents: 100_000,
  boat_id: null,
  status: 'active',
  flexibility: 'flexible',
  completed_transaction_id: null,
  completed_at: null,
  created_at: '2026-03-01T00:00:00.000Z',
  updated_at: '2026-03-01T00:00:00.000Z',
}

function db(row: typeof ROW | null = ROW) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table !== 'finance_goals') return { data: null }
    if (has(q, 'insert')) return { data: { ...ROW, ...(op(q, 'insert')!.args[0] as object), id: ID } }
    if (has(q, 'update')) return { data: { ...(row ?? ROW), ...(op(q, 'update')!.args[0] as object) } }
    if (has(q, 'maybeSingle')) return { data: row }
    return { data: row ? [row] : [] }
  })
}

const req = (method: string, body?: unknown, path = '') =>
  new NextRequest(`${BASE}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })
const params = (id = ID) => ({ params: Promise.resolve({ id }) })
const events = (queries: RecordedQuery[]) => queriesFor(queries, 'finance_events', 'insert').map(q => op(q, 'insert')!.args[0] as Record<string, unknown>)

describe('/api/admin/finance/cockpit/goals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
  })

  describe('GET', () => {
    it('passes the requireAdmin denial through', async () => {
      h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
      expect((await GET(req('GET'))).status).toBe(401)
    })

    it('defaults to active goals and attaches progress', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await GET(req('GET'))
      expect(res.status).toBe(200)
      const { data } = await res.json()
      expect(data).toHaveLength(1)
      expect(op(mock.queries[0], 'eq')?.args).toEqual(['status', 'active'])
      expect(data[0].progress).toMatchObject({ id: ID, targetCents: 1_500_000, fundedCents: 640_000, remainingCents: 860_000, progressPct: 43 })
      expect(typeof data[0].progress.onTrack).toBe('boolean')
    })

    it('status=all drops the filter; unknown status is a 400', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      await GET(req('GET', undefined, '?status=all'))
      expect(has(mock.queries[0], 'eq')).toBe(false)
      expect((await GET(req('GET', undefined, '?status=done'))).status).toBe(400)
    })
  })

  describe('POST', () => {
    it('rejects invalid bodies with 400', async () => {
      expect((await POST(req('POST', { target_cents: 100 }))).status).toBe(400)
      expect((await POST(req('POST', { name: 'x', target_cents: 0 }))).status).toBe(400)
      expect((await POST(req('POST', { name: 'x', target_cents: 100, priority: 6 }))).status).toBe(400)
      expect((await POST(req('POST', { name: 'x', target_cents: 100, funded_cents: -1 }))).status).toBe(400)
      expect(h.createAdminClient).not.toHaveBeenCalled()
    })

    it('creates with defaults and logs goal_created with delta = funded_cents', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await POST(req('POST', { name: 'Nieuwe motor Diana', target_cents: 1_500_000, funded_cents: 640_000 }))
      expect(res.status).toBe(201)
      const { data } = await res.json()
      expect(data.progress).toBeDefined()
      expect(opArg(mock.queries, 'finance_goals', 'insert')).toMatchObject({
        name: 'Nieuwe motor Diana', target_cents: 1_500_000, funded_cents: 640_000, priority: 3, monthly_funding_cents: 0, flexibility: 'flexible', status: 'active',
      })
      expect(events(mock.queries)[0]).toMatchObject({ event_type: 'goal_created', entity_type: 'goal', entity_id: ID, delta_cents: 640_000 })
    })

    it('logs a null delta when nothing is funded yet', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      await POST(req('POST', { name: 'Zonnepanelen', target_cents: 300_000 }))
      expect(events(mock.queries)[0]).toMatchObject({ event_type: 'goal_created', delta_cents: null })
    })
  })

  describe('[id] PUT', () => {
    it('rejects a bad id, empty patch, and a missing goal', async () => {
      expect((await PUT(req('PUT', { name: 'x' }), params('nope'))).status).toBe(400)
      expect((await PUT(req('PUT', {}), params())).status).toBe(400)
      h.createAdminClient.mockReturnValue(db(null).client)
      expect((await PUT(req('PUT', { name: 'x' }), params())).status).toBe(404)
    })

    it('a funded_cents change logs goal_funding_changed with delta = new − old', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await PUT(req('PUT', { funded_cents: 700_000 }), params())
      expect(res.status).toBe(200)
      const evs = events(mock.queries)
      expect(evs).toHaveLength(1)
      expect(evs[0]).toMatchObject({ event_type: 'goal_funding_changed', entity_id: ID, delta_cents: 60_000, payload: { before: 640_000, after: 700_000, reason: 'manual' } })
    })

    it('other changes log goal_updated; both together log both', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      await PUT(req('PUT', { priority: 1, status: 'paused' }), params())
      let evs = events(mock.queries)
      expect(evs).toHaveLength(1)
      expect(evs[0]).toMatchObject({ event_type: 'goal_updated', payload: { changed: ['priority', 'status'] } })

      const mock2 = db()
      h.createAdminClient.mockReturnValue(mock2.client)
      await PUT(req('PUT', { funded_cents: 600_000, name: 'Motor' }), params())
      evs = events(mock2.queries)
      expect(evs.map(e => e.event_type)).toEqual(['goal_funding_changed', 'goal_updated'])
      expect(evs[0].delta_cents).toBe(-40_000)
    })

    it('refuses to edit a completed goal', async () => {
      h.createAdminClient.mockReturnValue(db({ ...ROW, status: 'completed' }).client)
      expect((await PUT(req('PUT', { name: 'x' }), params())).status).toBe(400)
    })
  })

  describe('[id] DELETE', () => {
    it('hard-deletes and logs goal_deleted with delta = −funded', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await DELETE(req('DELETE'), params())
      expect(res.status).toBe(200)
      expect((await res.json()).data).toEqual({ id: ID, deleted: true })
      const del = queriesFor(mock.queries, 'finance_goals', 'delete')[0]
      expect(op(del, 'eq')?.args).toEqual(['id', ID])
      expect(events(mock.queries)[0]).toMatchObject({ event_type: 'goal_deleted', entity_id: ID, delta_cents: -640_000 })
    })
  })

  describe('[id]/complete', () => {
    it('passes the requireAdmin denial through', async () => {
      h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
      expect((await COMPLETE(req('POST', {}), params())).status).toBe(401)
    })

    it('marks completed, stamps completed_at, and releases the reserve (delta = −funded)', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      const tx = '44444444-4444-4444-8444-444444444444'
      const res = await COMPLETE(req('POST', { completed_transaction_id: tx }), params())
      expect(res.status).toBe(200)
      expect((await res.json()).data.status).toBe('completed')
      const update = opArg(mock.queries, 'finance_goals', 'update') as Record<string, unknown>
      expect(update).toMatchObject({ status: 'completed', completed_transaction_id: tx })
      expect(update.completed_at).toEqual(expect.any(String))
      expect(events(mock.queries)[0]).toMatchObject({ event_type: 'goal_completed', entity_id: ID, delta_cents: -640_000 })
    })

    it('refuses an already completed goal and a malformed transaction id', async () => {
      h.createAdminClient.mockReturnValue(db({ ...ROW, status: 'completed' }).client)
      expect((await COMPLETE(req('POST', {}), params())).status).toBe(400)
      expect((await COMPLETE(req('POST', { completed_transaction_id: 'abc' }), params())).status).toBe(400)
    })
  })
})
