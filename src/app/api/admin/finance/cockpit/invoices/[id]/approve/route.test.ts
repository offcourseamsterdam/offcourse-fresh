import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseChainMock, has, op, opArg, type RecordedQuery } from '@/test/supabase-chain-mock'
import { addDays, todayISO } from '@/lib/finance/cockpit/dates'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminClient: vi.fn(),
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))

import { POST } from './route'

const ID = '11111111-1111-4111-8111-111111111111'
const BASE = `https://offcourseamsterdam.com/api/admin/finance/cockpit/invoices/${ID}/approve`

const INVOICE = {
  id: ID,
  status: 'ready',
  decision: null as string | null,
  expected_amount_cents: 15000,
  matched_shift_id: null as string | null,
  extracted: {
    invoiceNumber: 'INV-1',
    invoiceDate: '2026-09-01',
    supplierName: 'Mare',
    amountCents: 15000,
  },
  checks: [{ key: 'amount', ok: true, detail: 'komt overeen' }],
  supplier: { id: 'sup-1', name: 'Mare', default_boat_id: 'boat-1' },
}

interface DbOpts {
  obligationInsert?: { data: { id: string } } | { data: null; error: { message: string; code: string } }
  existingObligation?: { id: string } | null
  /** null = the conditional decision update matched zero rows (someone else decided first). */
  decisionUpdate?: 'row' | 'none'
  shift?: { staff_id: string | null; date: string } | null
  crewAccrual?: { id: string; amount_cents: number; notes: string | null } | null
}

function db(invoice: Record<string, unknown> | null = INVOICE, opts: DbOpts = {}) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'finance_invoices') {
      if (has(q, 'update')) return opts.decisionUpdate === 'none' ? { data: null } : { data: { ...invoice, ...(op(q, 'update')!.args[0] as object) } }
      return { data: invoice }
    }
    if (q.table === 'finance_obligations') {
      if (has(q, 'insert')) return (opts.obligationInsert ?? { data: { id: 'ob-1' } }) as never
      if (has(q, 'update')) return { data: null }
      // select: reuse-after-23505 lookup (by invoice_id) or the crew accrual (by source_key)
      const eqCols = q.ops.filter(o => o.method === 'eq').map(o => o.args[0])
      if (eqCols.includes('invoice_id')) return { data: opts.existingObligation ?? null }
      return { data: opts.crewAccrual ?? null }
    }
    if (q.table === 'shifts') return { data: opts.shift ?? null }
    if (q.table === 'finance_events') return { data: null }
    return { data: null }
  })
}

const req = (body?: unknown) => new NextRequest(BASE, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const params = { params: Promise.resolve({ id: ID }) }
const events = (queries: RecordedQuery[]) => queries.filter(q => q.table === 'finance_events').map(q => op(q, 'insert')!.args[0] as Record<string, unknown>)
const decisionUpdate = (queries: RecordedQuery[]) => opArg(queries, 'finance_invoices', 'update') as Record<string, unknown>

describe('POST /api/admin/finance/cockpit/invoices/[id]/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
  })

  it('passes the requireAdmin denial through', async () => {
    h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
    expect((await POST(req(), params)).status).toBe(401)
  })

  it('rejects a non-uuid id', async () => {
    expect((await POST(req(), { params: Promise.resolve({ id: 'nope' }) })).status).toBe(400)
  })

  it('returns 404 when the invoice does not exist', async () => {
    h.createAdminClient.mockReturnValue(db(null).client)
    expect((await POST(req(), params)).status).toBe(404)
  })

  it('refuses an invoice that already has a decision', async () => {
    h.createAdminClient.mockReturnValue(db({ ...INVOICE, decision: 'rejected' }).client)
    const res = await POST(req(), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('already rejected')
  })

  it('refuses when there is no amount anywhere, with nothing to suggest', async () => {
    h.createAdminClient.mockReturnValue(db({ ...INVOICE, expected_amount_cents: null, checks: [], extracted: { ...INVOICE.extracted, amountCents: null } }).client)
    const res = await POST(req(), params)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toContain('Geen bedrag')
    expect(body.suggested_cents).toBeNull()
  })

  it('approves a ready invoice: decision=approved, creates the obligation, logs invoice_approved', async () => {
    const mock = db()
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await POST(req(), params)
    expect(res.status).toBe(200)

    const obligation = opArg(mock.queries, 'finance_obligations', 'insert') as Record<string, unknown>
    expect(obligation).toMatchObject({
      title: 'Factuur Mare #INV-1',
      kind: 'invoice',
      amount_cents: 15000,
      due_date: '2026-09-15', // invoiceDate + 14d
      boat_id: 'boat-1',
      invoice_id: ID,
      status: 'open',
    })

    expect(decisionUpdate(mock.queries)).toMatchObject({ status: 'approved', decision: 'approved', obligation_id: 'ob-1' })
    // Written once: the update is guarded on decision IS NULL.
    const upd = mock.queries.find(q => q.table === 'finance_invoices' && has(q, 'update'))!
    expect(op(upd, 'is')!.args).toEqual(['decision', null])

    expect(events(mock.queries)[0]).toMatchObject({ event_type: 'invoice_approved', entity_type: 'invoice', entity_id: ID, delta_cents: 15000 })
    expect((await res.json()).data.amount_source).toBe('extracted')
  })

  it('a needs_review invoice approves as an override, never silently as a clean approval', async () => {
    const mock = db({ ...INVOICE, status: 'needs_review' })
    h.createAdminClient.mockReturnValue(mock.client)
    await POST(req(), params)
    expect(decisionUpdate(mock.queries)).toMatchObject({ decision: 'approved_override' })
  })

  it('falls back to today + 14 days when the invoice has no extracted invoiceDate', async () => {
    const mock = db({ ...INVOICE, extracted: { ...INVOICE.extracted, invoiceDate: null } })
    h.createAdminClient.mockReturnValue(mock.client)
    await POST(req(), params)
    const obligation = opArg(mock.queries, 'finance_obligations', 'insert') as Record<string, unknown>
    expect(obligation.due_date).toBe(addDays(todayISO(), 14))
  })

  it('an optional note is stored as decision_note', async () => {
    const mock = db()
    h.createAdminClient.mockReturnValue(mock.client)
    await POST(req({ note: 'Beer approved by phone' }), params)
    expect(decisionUpdate(mock.queries)).toMatchObject({ decision_note: 'Beer approved by phone' })
  })

  // ── the 2026-09-04 review fixes ─────────────────────────────────────────────

  it('never books the PDF\'s number when the amount check failed — uses hours × rate instead', async () => {
    const mock = db({
      ...INVOICE,
      status: 'needs_review',
      expected_amount_cents: 14000,
      checks: [{ key: 'amount', ok: false, detail: 'Afgesproken €140,00, factuur €150,00' }],
    })
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await POST(req(), params)
    expect(res.status).toBe(200)
    expect(opArg(mock.queries, 'finance_obligations', 'insert')).toMatchObject({ amount_cents: 14000 })
    expect(events(mock.queries)[0]).toMatchObject({ delta_cents: 14000 })
    expect((await res.json()).data.amount_source).toBe('expected')
  })

  it('a typed amount_cents overrides both the PDF and the expectation', async () => {
    const mock = db()
    h.createAdminClient.mockReturnValue(mock.client)
    await POST(req({ amount_cents: 14250 }), params)
    expect(opArg(mock.queries, 'finance_obligations', 'insert')).toMatchObject({ amount_cents: 14250 })
  })

  it('a non-skipper supplier with no expectation gets a 400 that pre-fills the extracted amount', async () => {
    const mock = db({ ...INVOICE, expected_amount_cents: null, checks: [{ key: 'amount', ok: false, detail: 'Geen verwacht bedrag te berekenen' }] })
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await POST(req(), params)
    expect(res.status).toBe(400)
    expect((await res.json()).suggested_cents).toBe(15000)
    expect(mock.queries.some(q => q.table === 'finance_obligations')).toBe(false)
  })

  it('a retry after a half-finished attempt reuses the existing obligation instead of creating a second one', async () => {
    const mock = db(INVOICE, {
      obligationInsert: { data: null, error: { message: 'duplicate key value violates unique constraint', code: '23505' } },
      existingObligation: { id: 'ob-from-first-try' },
    })
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await POST(req(), params)
    expect(res.status).toBe(200)
    expect(decisionUpdate(mock.queries)).toMatchObject({ obligation_id: 'ob-from-first-try' })
    expect(events(mock.queries)[0].payload).toMatchObject({ obligation_reused: true })
  })

  it('two racing approvals: the loser gets 409 and does not log an event', async () => {
    const mock = db(INVOICE, { decisionUpdate: 'none' })
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await POST(req(), params)
    expect(res.status).toBe(409)
    expect(events(mock.queries)).toHaveLength(0)
  })

  it('a skipper invoice supersedes that skipper-month\'s crew accrual by its amount', async () => {
    const mock = db(
      { ...INVOICE, matched_shift_id: 'shift-1' },
      { shift: { staff_id: 'staff-1', date: '2026-08-30' }, crewAccrual: { id: 'crew-aug', amount_cents: 50000, notes: null } },
    )
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await POST(req(), params)
    expect(res.status).toBe(200)

    const accrualUpdate = opArg(mock.queries, 'finance_obligations', 'update') as Record<string, unknown>
    expect(accrualUpdate).toMatchObject({ amount_cents: 35000, status: 'open' })
    const body = await res.json()
    expect(body.data.superseded).toMatchObject({ obligationId: 'crew-aug', sourceKey: 'skipper-hours:2026-08:staff-1', remainingCents: 35000, cancelled: false })
    expect(events(mock.queries).map(e => e.event_type)).toEqual(['obligation_updated', 'invoice_approved'])
  })

  it('a marina invoice (no matched shift) touches no crew accrual', async () => {
    const mock = db()
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await POST(req(), params)
    expect((await res.json()).data.superseded).toBeNull()
    expect(mock.queries.some(q => q.table === 'shifts')).toBe(false)
  })
})
