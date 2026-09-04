import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseChainMock, has, op, opArg, queriesFor, type RecordedQuery } from '@/test/supabase-chain-mock'
import type { CockpitInputs } from '@/lib/finance/cockpit/types'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminClient: vi.fn(),
  loadCockpitInputs: vi.fn(),
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))
vi.mock('@/lib/finance/cockpit/load-cockpit', () => ({ loadCockpitInputs: h.loadCockpitInputs }))

import { GET, POST } from './route'
import { GET as GET_ONE, PUT, DELETE } from './[id]/route'
import { POST as SCENARIO } from './scenario/route'

const ID = '11111111-1111-4111-8111-111111111111'
const BASE = 'https://offcourseamsterdam.com/api/admin/finance/cockpit/investments'

const ROW = {
  id: ID,
  title: 'Tweede boot',
  amount_cents: 4_500_000,
  boat_id: null,
  type: 'capacity',
  impact: { capacity: 5, revenue: 4, confidence: 3 },
  expected_return_cents: null as number | null,
  status: 'idea',
  executed_transaction_id: null,
  goal_id: null,
  notes: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
}

function db(row: typeof ROW | null = ROW) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table !== 'finance_investments') return { data: null }
    if (has(q, 'insert')) return { data: { ...ROW, ...(op(q, 'insert')!.args[0] as object), id: ID } }
    if (has(q, 'update')) return { data: { ...(row ?? ROW), ...(op(q, 'update')!.args[0] as object) } }
    if (has(q, 'maybeSingle')) return { data: row }
    return { data: row ? [row] : [] }
  })
}

/** €20.000 cash, €5.000 margin, nothing claimed → €15.000 of growth room. */
function inputs(over: Partial<CockpitInputs> = {}): CockpitInputs {
  return {
    today: '2026-09-04',
    horizon: '3m',
    cash: { clearedCents: 2_000_000, pendingOutCents: 0, pendingInCents: 0, source: 'manual', asOf: null },
    obligations: [],
    operationalCoverageCents: 0,
    ownerSalary: { monthlyCents: 0, months: 3, coverageCents: 0 },
    goals: [],
    safetyMarginCents: 500_000,
    ...over,
  }
}

const req = (method: string, body?: unknown, path = '') =>
  new NextRequest(`${BASE}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })
const params = (id = ID) => ({ params: Promise.resolve({ id }) })
const events = (queries: RecordedQuery[]) => queriesFor(queries, 'finance_events', 'insert').map(q => op(q, 'insert')?.args[0] as Record<string, unknown>)

describe('/api/admin/finance/cockpit/investments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
    h.loadCockpitInputs.mockResolvedValue({ inputs: inputs(), settings: {} })
  })

  describe('GET (list)', () => {
    it('passes the requireAdmin denial through', async () => {
      h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
      expect((await GET(req('GET'))).status).toBe(401)
    })

    it('defaults to the still-open shortlist', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await GET(req('GET'))
      expect(res.status).toBe(200)
      expect(op(mock.queries[0], 'in')?.args).toEqual(['status', ['idea', 'planned', 'approved']])
    })

    it('status=all drops the filter; an unknown status is a 400', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      await GET(req('GET', undefined, '?status=all'))
      expect(has(mock.queries[0], 'in')).toBe(false)
      expect(has(mock.queries[0], 'eq')).toBe(false)
      expect((await GET(req('GET', undefined, '?status=bogus'))).status).toBe(400)
    })
  })

  describe('POST (create)', () => {
    it('rejects a missing title and an out-of-range impact score', async () => {
      expect((await POST(req('POST', { amount_cents: 100 }))).status).toBe(400)
      expect((await POST(req('POST', { title: 'x', amount_cents: 100, impact: { capacity: 9 } }))).status).toBe(400)
      expect(h.createAdminClient).not.toHaveBeenCalled()
    })

    it('creates an idea and logs it with NO delta — an idea claims no money', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await POST(req('POST', { title: 'Tweede boot', amount_cents: 4_500_000, type: 'capacity', impact: { capacity: 5 } }))
      expect(res.status).toBe(201)

      expect(opArg(mock.queries, 'finance_investments', 'insert')).toMatchObject({ title: 'Tweede boot', amount_cents: 4_500_000, type: 'capacity', status: 'idea' })
      const ev = events(mock.queries)[0]
      expect(ev).toMatchObject({ event_type: 'investment_created', entity_type: 'investment', entity_id: ID })
      expect(ev.delta_cents ?? null).toBeNull()
    })

    it('keeps expected_return_cents null rather than defaulting it to zero', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      await POST(req('POST', { title: 'Onbekend rendement', amount_cents: 100_000 }))
      expect((opArg(mock.queries, 'finance_investments', 'insert') as Record<string, unknown>).expected_return_cents).toBeNull()
    })
  })

  describe('[id]', () => {
    it('404s for an unknown id and 400s for a non-uuid', async () => {
      h.createAdminClient.mockReturnValue(db(null).client)
      expect((await GET_ONE(req('GET'), params())).status).toBe(404)
      expect((await PUT(req('PUT', { title: 'x' }), params('nope'))).status).toBe(400)
    })

    it('a status change gets its own decision-trail event', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await PUT(req('PUT', { status: 'approved' }), params())
      expect(res.status).toBe(200)

      const evs = events(mock.queries)
      expect(evs[0]).toMatchObject({ event_type: 'investment_status_changed' })
      expect(evs[0].payload).toMatchObject({ before: 'idea', after: 'approved' })
    })

    it('a field edit logs investment_updated with only the changed keys', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      await PUT(req('PUT', { amount_cents: 5_000_000 }), params())

      const evs = events(mock.queries)
      expect(evs[0]).toMatchObject({ event_type: 'investment_updated' })
      expect((evs[0].payload as Record<string, unknown>).changed).toEqual(['amount_cents'])
    })

    it('delete logs no delta — there was never a reserve to release', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await DELETE(req('DELETE'), params())
      expect(res.status).toBe(200)
      const ev = events(mock.queries)[0]
      expect(ev).toMatchObject({ event_type: 'investment_deleted' })
      expect(ev.delta_cents ?? null).toBeNull()
    })
  })

  describe('scenario', () => {
    it('requires either an id or an amount', async () => {
      expect((await SCENARIO(req('POST', {}))).status).toBe(400)
    })

    it('is exactly compute(cash − amount): same engine, cash reduced by the spend', async () => {
      h.createAdminClient.mockReturnValue(db().client)
      const res = await SCENARIO(req('POST', { amount_cents: 300_000 }))
      const { data } = await res.json()

      expect(data.before.cash.clearedCents).toBe(2_000_000)
      expect(data.after.cash.clearedCents).toBe(1_700_000)
      expect(data.after.financialSpaceCents).toBe(data.before.financialSpaceCents - 300_000)
      expect(data.after.availableForGrowthCents).toBe(data.before.availableForGrowthCents - 300_000)
      expect(data.delta.availableForGrowthCents).toBe(-300_000)
    })

    it('affordable is measured against the growth room, not the raw balance', async () => {
      h.createAdminClient.mockReturnValue(db().client)
      // €15.000 of growth room on €20.000 of cash.
      const fits = await (await SCENARIO(req('POST', { amount_cents: 1_500_000 }))).json()
      expect(fits.data.affordable).toBe(true)
      expect(fits.data.after.marginShortfallCents).toBe(0)

      const tooBig = await (await SCENARIO(req('POST', { amount_cents: 1_600_000 }))).json()
      expect(tooBig.data.affordable).toBe(false) // still covered by cash, but it eats the safety margin
      expect(tooBig.data.after.marginShortfallCents).toBe(100_000)
    })

    it('takes the amount from the investment when only an id is given', async () => {
      h.createAdminClient.mockReturnValue(db().client)
      const { data } = await (await SCENARIO(req('POST', { investment_id: ID }))).json()
      expect(data.amountCents).toBe(4_500_000)
      expect(data.investment).toMatchObject({ id: ID, title: 'Tweede boot' })
      expect(data.affordable).toBe(false)
    })

    it('an explicit amount overrides the investment’s own price', async () => {
      h.createAdminClient.mockReturnValue(db().client)
      const { data } = await (await SCENARIO(req('POST', { investment_id: ID, amount_cents: 100_000 }))).json()
      expect(data.amountCents).toBe(100_000)
    })

    it('404s on an unknown investment id', async () => {
      h.createAdminClient.mockReturnValue(db(null).client)
      expect((await SCENARIO(req('POST', { investment_id: ID }))).status).toBe(404)
    })
  })
})
