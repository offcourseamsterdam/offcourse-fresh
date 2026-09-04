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
import { POST as MARK_PAID } from './[id]/mark-paid/route'
import { POST as REOPEN } from './[id]/reopen/route'

const ID = '11111111-1111-4111-8111-111111111111'
const BASE = 'https://offcourseamsterdam.com/api/admin/finance/cockpit/obligations'
const ROW = {
  id: ID,
  title: 'BTW Q3',
  kind: 'tax',
  amount_cents: 480_000,
  due_date: '2026-10-31',
  recurrence_months: null,
  recurrence_until: null,
  boat_id: null,
  loan_id: null,
  invoice_id: null,
  status: 'open',
  paid_transaction_id: null as string | null,
  paid_at: null as string | null,
  notes: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
}

/** Reads return `row` (or null); inserts/updates echo their payload merged onto it. */
function db(row: typeof ROW | null = ROW) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table !== 'finance_obligations') return { data: null }
    if (has(q, 'insert')) return { data: { ...ROW, ...(op(q, 'insert')!.args[0] as object), id: ID } }
    if (has(q, 'update')) return { data: { ...(row ?? ROW), ...(op(q, 'update')!.args[0] as object) } }
    if (has(q, 'maybeSingle')) return { data: row }
    return { data: row ? [row] : [] }
  })
}

const req = (method: string, body?: unknown, path = '') =>
  new NextRequest(`${BASE}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })
const params = (id = ID) => ({ params: Promise.resolve({ id }) })
const event = (queries: RecordedQuery[]) => opArg(queries, 'finance_events', 'insert') as Record<string, unknown>

describe('/api/admin/finance/cockpit/obligations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
  })

  describe('GET', () => {
    it('passes the requireAdmin denial through', async () => {
      h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
      expect((await GET(req('GET'))).status).toBe(401)
    })

    it('defaults to open obligations ordered by due date', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await GET(req('GET'))
      expect(res.status).toBe(200)
      expect((await res.json()).data).toHaveLength(1)
      const q = mock.queries[0]
      expect(op(q, 'order')?.args[0]).toBe('due_date')
      expect(op(q, 'eq')?.args).toEqual(['status', 'open'])
    })

    it('status=all drops the status filter; an unknown status is a 400', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      await GET(req('GET', undefined, '?status=all'))
      expect(has(mock.queries[0], 'eq')).toBe(false)
      expect((await GET(req('GET', undefined, '?status=bogus'))).status).toBe(400)
    })
  })

  describe('POST', () => {
    it('passes the requireAdmin denial through', async () => {
      h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 403 }))
      expect((await POST(req('POST', { title: 'x' }))).status).toBe(403)
    })

    it('rejects kind=loan, missing fields and bad values with 400', async () => {
      const loan = await POST(req('POST', { title: 'Lening', kind: 'loan', amount_cents: 1, due_date: '2026-10-01' }))
      expect(loan.status).toBe(400)
      expect((await loan.json()).error).toContain("kind: kind 'loan' is not allowed")
      expect((await POST(req('POST', { kind: 'tax', amount_cents: 1, due_date: '2026-10-01' }))).status).toBe(400)
      expect((await POST(req('POST', { title: 'x', kind: 'tax', amount_cents: 10.5, due_date: '2026-10-01' }))).status).toBe(400)
      expect((await POST(req('POST', { title: 'x', kind: 'tax', amount_cents: 1, due_date: '31-10-2026' }))).status).toBe(400)
      expect((await POST(req('POST', { title: 'x', kind: 'tax', amount_cents: 1, due_date: '2026-10-01', recurrence_months: 2 }))).status).toBe(400)
      expect((await POST(req('POST', 'not json'))).status).toBe(400)
      expect(h.createAdminClient).not.toHaveBeenCalled()
    })

    it('inserts an open obligation and logs obligation_created', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await POST(req('POST', { title: '  BTW Q3 ', kind: 'tax', amount_cents: 480_000, due_date: '2026-10-31', recurrence_months: 3 }))
      expect(res.status).toBe(201)
      expect((await res.json()).data.id).toBe(ID)

      expect(opArg(mock.queries, 'finance_obligations', 'insert')).toMatchObject({
        title: 'BTW Q3', kind: 'tax', amount_cents: 480_000, due_date: '2026-10-31', recurrence_months: 3, status: 'open', boat_id: null,
      })
      expect(event(mock.queries)).toMatchObject({ event_type: 'obligation_created', entity_type: 'obligation', entity_id: ID, actor: 'user', delta_cents: null })
    })
  })

  describe('[id] PUT', () => {
    it('rejects a non-uuid id and an empty patch', async () => {
      expect((await PUT(req('PUT', { title: 'x' }), params('nope'))).status).toBe(400)
      expect((await PUT(req('PUT', {}), params())).status).toBe(400)
    })

    it('returns 404 when the obligation does not exist', async () => {
      h.createAdminClient.mockReturnValue(db(null).client)
      expect((await PUT(req('PUT', { title: 'x' }), params())).status).toBe(404)
    })

    it('updates and logs obligation_updated with only the changed keys', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await PUT(req('PUT', { amount_cents: 500_000, title: 'BTW Q3' }), params())
      expect(res.status).toBe(200)
      expect((await res.json()).data.amount_cents).toBe(500_000)
      const ev = event(mock.queries)
      expect(ev.event_type).toBe('obligation_updated')
      expect(ev.payload).toEqual({ changed: ['amount_cents'], before: { amount_cents: 480_000 }, after: { amount_cents: 500_000 } })
    })
  })

  describe('[id] DELETE', () => {
    it('soft-cancels instead of deleting, and logs obligation_cancelled', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await DELETE(req('DELETE'), params())
      expect(res.status).toBe(200)
      expect((await res.json()).data.status).toBe('cancelled')
      expect(queriesFor(mock.queries, 'finance_obligations', 'delete')).toHaveLength(0)
      expect(opArg(mock.queries, 'finance_obligations', 'update')).toMatchObject({ status: 'cancelled' })
      expect(event(mock.queries)).toMatchObject({ event_type: 'obligation_cancelled', entity_id: ID })
    })
  })

  describe('[id]/mark-paid', () => {
    it('passes the requireAdmin denial through', async () => {
      h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
      expect((await MARK_PAID(req('POST', {}), params())).status).toBe(401)
    })

    it('refuses a cancelled or already-paid obligation', async () => {
      h.createAdminClient.mockReturnValue(db({ ...ROW, status: 'cancelled' }).client)
      expect((await MARK_PAID(req('POST', {}), params())).status).toBe(400)
      h.createAdminClient.mockReturnValue(db({ ...ROW, status: 'paid' }).client)
      expect((await MARK_PAID(req('POST', {}), params())).status).toBe(400)
    })

    it('rejects a malformed paid_at or transaction id', async () => {
      expect((await MARK_PAID(req('POST', { paid_at: 'yesterday' }), params())).status).toBe(400)
      expect((await MARK_PAID(req('POST', { paid_transaction_id: 'tx-1' }), params())).status).toBe(400)
    })

    it('marks paid (paid_at defaults to now) and logs obligation_paid with delta = amount', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await MARK_PAID(req('POST', {}), params())
      expect(res.status).toBe(200)
      const update = opArg(mock.queries, 'finance_obligations', 'update') as Record<string, unknown>
      expect(update.status).toBe('paid')
      expect(update.paid_at).toEqual(expect.any(String))
      expect(update.paid_transaction_id).toBeNull()
      expect(event(mock.queries)).toMatchObject({ event_type: 'obligation_paid', entity_id: ID, delta_cents: 480_000 })
    })

    it('a recurring obligation rolls forward to its next due date instead of closing', async () => {
      const mock = db({ ...ROW, due_date: '2026-10-31', recurrence_months: 3, recurrence_until: null })
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await MARK_PAID(req('POST', {}), params())
      expect(res.status).toBe(200)
      const update = opArg(mock.queries, 'finance_obligations', 'update') as Record<string, unknown>
      expect(update.due_date).toBe('2027-01-31')
      expect(update.status).toBeUndefined()
      expect(event(mock.queries)).toMatchObject({ event_type: 'obligation_paid', delta_cents: 480_000 })
      expect((event(mock.queries).payload as Record<string, unknown>).rolled_to).toBe('2027-01-31')
    })

    it('the last occurrence of a bounded recurrence closes the row', async () => {
      const mock = db({ ...ROW, due_date: '2026-10-31', recurrence_months: 3, recurrence_until: '2026-12-31' })
      h.createAdminClient.mockReturnValue(mock.client)
      await MARK_PAID(req('POST', {}), params())
      const update = opArg(mock.queries, 'finance_obligations', 'update') as Record<string, unknown>
      expect(update.status).toBe('paid')
      expect(update.due_date).toBeUndefined()
    })

    it('honours an explicit paid_at and transaction id', async () => {
      const mock = db()
      h.createAdminClient.mockReturnValue(mock.client)
      const tx = '22222222-2222-4222-8222-222222222222'
      await MARK_PAID(req('POST', { paid_at: '2026-10-30T10:00:00Z', paid_transaction_id: tx }), params())
      expect(opArg(mock.queries, 'finance_obligations', 'update')).toMatchObject({ paid_at: '2026-10-30T10:00:00.000Z', paid_transaction_id: tx })
    })
  })

  describe('[id]/reopen', () => {
    it('reopens a paid obligation, clears paid fields and logs the reverse delta', async () => {
      const mock = db({ ...ROW, status: 'paid', paid_at: '2026-10-30T10:00:00.000Z' })
      h.createAdminClient.mockReturnValue(mock.client)
      const res = await REOPEN(req('POST'), params())
      expect(res.status).toBe(200)
      expect(opArg(mock.queries, 'finance_obligations', 'update')).toMatchObject({ status: 'open', paid_at: null, paid_transaction_id: null })
      expect(event(mock.queries)).toMatchObject({ event_type: 'obligation_reopened', delta_cents: -480_000 })
    })

    it('refuses to reopen an already-open obligation', async () => {
      h.createAdminClient.mockReturnValue(db().client)
      expect((await REOPEN(req('POST'), params())).status).toBe(400)
    })
  })
})
