import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseChainMock, has, op, opArg, type RecordedQuery } from '@/test/supabase-chain-mock'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminClient: vi.fn(),
  loadConnection: vi.fn(),
  createRevolutClient: vi.fn(),
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))
vi.mock('@/lib/revolut/token-store', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/revolut/token-store')>()),
  loadConnection: h.loadConnection,
  createRevolutClient: h.createRevolutClient,
}))

import { POST } from './route'

const ID = '11111111-1111-4111-8111-111111111111'
const BASE = `https://offcourseamsterdam.com/api/admin/finance/cockpit/invoices/${ID}/pay`

const CONNECTED_ROW = {
  id: 'default',
  refresh_token_enc: 'enc',
  consented_at: '2026-08-01T00:00:00.000Z',
  account_id: 'acct-1',
}

// A real, checksum-valid IBAN (the ISO 13616 example) — pay/route.ts now runs mod-97 before Revolut ever sees it.
const VALID_IBAN = 'NL91ABNA0417164300'

const INVOICE = {
  id: ID,
  status: 'ready',
  decision: null as string | null,
  expected_amount_cents: 15000,
  matched_shift_id: null as string | null,
  revolut_draft_id: null as string | null,
  extracted: { invoiceNumber: 'INV-1', invoiceDate: '2026-09-01', amountCents: 15000 },
  checks: [{ key: 'amount', ok: true, detail: 'komt overeen' }],
  supplier: { id: 'sup-1', name: 'Mare', iban: VALID_IBAN, default_boat_id: 'boat-1', revolut_counterparty_id: null as string | null },
}

interface DbOpts {
  obligationInsert?: { data: { id: string } } | { data: null; error: { message: string; code: string } }
  existingObligation?: { id: string } | null
  decisionUpdate?: 'row' | 'none'
  shift?: { staff_id: string | null; date: string } | null
  crewAccrual?: { id: string; amount_cents: number; notes: string | null } | null
}

function db(invoice: Record<string, unknown> | null = INVOICE, opts: DbOpts = {}) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'finance_invoices') {
      if (has(q, 'update')) {
        const patch = op(q, 'update')!.args[0] as Record<string, unknown>
        // The draft-id pin is a plain update; only the DECISION write is the conditional one that can match zero rows.
        if ('decision' in patch && opts.decisionUpdate === 'none') return { data: null }
        return { data: { ...invoice, ...patch } }
      }
      return { data: invoice }
    }
    if (q.table === 'finance_obligations') {
      if (has(q, 'insert')) return (opts.obligationInsert ?? { data: { id: 'ob-1' } }) as never
      if (has(q, 'update')) return { data: null }
      const eqCols = q.ops.filter(o => o.method === 'eq').map(o => o.args[0])
      if (eqCols.includes('invoice_id')) return { data: opts.existingObligation ?? null }
      return { data: opts.crewAccrual ?? null }
    }
    if (q.table === 'shifts') return { data: opts.shift ?? null }
    if (q.table === 'finance_suppliers' && has(q, 'update')) return { data: null }
    if (q.table === 'finance_events') return { data: null }
    return { data: null }
  })
}

function revolutClient(overrides: { createCounterparty?: ReturnType<typeof vi.fn>; createPaymentDraft?: ReturnType<typeof vi.fn> } = {}) {
  return {
    createCounterparty: overrides.createCounterparty ?? vi.fn().mockResolvedValue({ id: 'cp-1' }),
    createPaymentDraft: overrides.createPaymentDraft ?? vi.fn().mockResolvedValue({ id: 'draft-1' }),
  }
}

const req = (body?: unknown) => new NextRequest(BASE, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const params = { params: Promise.resolve({ id: ID }) }
const events = (queries: RecordedQuery[]) => queries.filter(q => q.table === 'finance_events').map(q => op(q, 'insert')!.args[0] as Record<string, unknown>)
const invoiceUpdates = (queries: RecordedQuery[]) =>
  queries.filter(q => q.table === 'finance_invoices' && has(q, 'update')).map(q => op(q, 'update')!.args[0] as Record<string, unknown>)
const decisionUpdate = (queries: RecordedQuery[]) => invoiceUpdates(queries).find(u => 'decision' in u)!

describe('POST /api/admin/finance/cockpit/invoices/[id]/pay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
    h.loadConnection.mockResolvedValue(CONNECTED_ROW)
    h.createRevolutClient.mockResolvedValue(revolutClient())
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
    h.createAdminClient.mockReturnValue(db({ ...INVOICE, decision: 'approved' }).client)
    expect((await POST(req(), params)).status).toBe(400)
  })

  it('refuses when there is no amount to pay', async () => {
    h.createAdminClient.mockReturnValue(db({ ...INVOICE, expected_amount_cents: null, checks: [], extracted: { ...INVOICE.extracted, amountCents: null } }).client)
    const res = await POST(req(), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('Geen bedrag')
  })

  it('refuses when the supplier has no known IBAN', async () => {
    h.createAdminClient.mockReturnValue(db({ ...INVOICE, supplier: { ...INVOICE.supplier, iban: null } }).client)
    const res = await POST(req(), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('IBAN')
  })

  it('refuses an IBAN that fails its checksum before creating a Revolut payee', async () => {
    h.createAdminClient.mockReturnValue(db({ ...INVOICE, supplier: { ...INVOICE.supplier, iban: 'NL91ABNA0417164301' } }).client)
    const cpMock = vi.fn()
    h.createRevolutClient.mockResolvedValue(revolutClient({ createCounterparty: cpMock }))
    const res = await POST(req(), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('checksum')
    expect(cpMock).not.toHaveBeenCalled()
  })

  it('refuses when Revolut is not connected', async () => {
    h.createAdminClient.mockReturnValue(db().client)
    h.loadConnection.mockResolvedValue({ id: 'default', refresh_token_enc: null, consented_at: null, account_id: null })
    const res = await POST(req(), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('not connected')
  })

  it('refuses when no Revolut account is selected', async () => {
    h.createAdminClient.mockReturnValue(db().client)
    h.loadConnection.mockResolvedValue({ ...CONNECTED_ROW, account_id: null })
    const res = await POST(req(), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('account')
  })

  it('creates a counterparty on first use, a draft, an obligation; moves to payment_pending', async () => {
    const mock = db()
    h.createAdminClient.mockReturnValue(mock.client)
    const cpMock = vi.fn().mockResolvedValue({ id: 'cp-new' })
    const draftMock = vi.fn().mockResolvedValue({ id: 'draft-new' })
    h.createRevolutClient.mockResolvedValue(revolutClient({ createCounterparty: cpMock, createPaymentDraft: draftMock }))

    const res = await POST(req(), params)
    expect(res.status).toBe(200)

    expect(cpMock).toHaveBeenCalledWith({ company_name: 'Mare', bank_country: 'NL', currency: 'EUR', iban: VALID_IBAN })
    expect(opArg(mock.queries, 'finance_suppliers', 'update')).toEqual({ revolut_counterparty_id: 'cp-new' })

    expect(draftMock).toHaveBeenCalledWith({
      title: 'Factuur Mare #INV-1',
      payments: [{ account_id: 'acct-1', receiver: { counterparty_id: 'cp-new' }, amount: 150, currency: 'EUR', reference: 'Factuur Mare #INV-1' }],
    })

    const obligation = opArg(mock.queries, 'finance_obligations', 'insert') as Record<string, unknown>
    expect(obligation).toMatchObject({ title: 'Factuur Mare #INV-1', kind: 'invoice', amount_cents: 15000, boat_id: 'boat-1', invoice_id: ID })

    expect(decisionUpdate(mock.queries)).toMatchObject({ status: 'payment_pending', decision: 'approved', obligation_id: 'ob-1', revolut_draft_id: 'draft-new' })
    expect(events(mock.queries)[0]).toMatchObject({ event_type: 'invoice_payment_drafted', entity_type: 'invoice', entity_id: ID, delta_cents: 15000 })
  })

  it('pins the draft id to the invoice BEFORE inserting the obligation, so a later failure can never orphan the draft', async () => {
    const mock = db()
    h.createAdminClient.mockReturnValue(mock.client)
    await POST(req(), params)

    const pinIdx = mock.queries.findIndex(q => q.table === 'finance_invoices' && has(q, 'update') && (op(q, 'update')!.args[0] as Record<string, unknown>).revolut_draft_id === 'draft-1' && !('decision' in (op(q, 'update')!.args[0] as object)))
    const obligationIdx = mock.queries.findIndex(q => q.table === 'finance_obligations' && has(q, 'insert'))
    expect(pinIdx).toBeGreaterThanOrEqual(0)
    expect(pinIdx).toBeLessThan(obligationIdx)
  })

  it('a retry after the draft was already created reuses it — no second draft in Beer\'s Revolut app', async () => {
    const mock = db({ ...INVOICE, revolut_draft_id: 'draft-from-first-try', supplier: { ...INVOICE.supplier, revolut_counterparty_id: 'cp-existing' } })
    h.createAdminClient.mockReturnValue(mock.client)
    const draftMock = vi.fn()
    h.createRevolutClient.mockResolvedValue(revolutClient({ createPaymentDraft: draftMock }))

    const res = await POST(req(), params)
    expect(res.status).toBe(200)
    expect(draftMock).not.toHaveBeenCalled()
    expect(decisionUpdate(mock.queries)).toMatchObject({ revolut_draft_id: 'draft-from-first-try' })
  })

  it('a retry that hits the obligation unique index reuses the existing obligation', async () => {
    const mock = db(INVOICE, {
      obligationInsert: { data: null, error: { message: 'duplicate key', code: '23505' } },
      existingObligation: { id: 'ob-from-first-try' },
    })
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await POST(req(), params)
    expect(res.status).toBe(200)
    expect(decisionUpdate(mock.queries)).toMatchObject({ obligation_id: 'ob-from-first-try' })
  })

  it('reuses an existing counterparty instead of creating a new one', async () => {
    const mock = db({ ...INVOICE, supplier: { ...INVOICE.supplier, revolut_counterparty_id: 'cp-existing' } })
    h.createAdminClient.mockReturnValue(mock.client)
    const cpMock = vi.fn()
    const draftMock = vi.fn().mockResolvedValue({ id: 'draft-1' })
    h.createRevolutClient.mockResolvedValue(revolutClient({ createCounterparty: cpMock, createPaymentDraft: draftMock }))

    await POST(req(), params)

    expect(cpMock).not.toHaveBeenCalled()
    expect(mock.queries.some(q => q.table === 'finance_suppliers' && has(q, 'update'))).toBe(false)
    expect(draftMock.mock.calls[0][0].payments[0].receiver).toEqual({ counterparty_id: 'cp-existing' })
  })

  it('a needs_review invoice pays as an override decision', async () => {
    const mock = db({ ...INVOICE, status: 'needs_review' })
    h.createAdminClient.mockReturnValue(mock.client)
    await POST(req(), params)
    expect(decisionUpdate(mock.queries)).toMatchObject({ decision: 'approved_override' })
  })

  it('drafts the EXPECTED amount, not the PDF\'s, when the amount check failed', async () => {
    const mock = db({ ...INVOICE, status: 'needs_review', expected_amount_cents: 14000, checks: [{ key: 'amount', ok: false, detail: 'afwijking' }] })
    h.createAdminClient.mockReturnValue(mock.client)
    const draftMock = vi.fn().mockResolvedValue({ id: 'draft-1' })
    h.createRevolutClient.mockResolvedValue(revolutClient({ createPaymentDraft: draftMock }))

    await POST(req(), params)
    expect(draftMock.mock.calls[0][0].payments[0].amount).toBe(140)
    expect(opArg(mock.queries, 'finance_obligations', 'insert')).toMatchObject({ amount_cents: 14000 })
  })

  it('a racing second request gets 409 after the draft check, and logs nothing', async () => {
    const mock = db(INVOICE, { decisionUpdate: 'none' })
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await POST(req(), params)
    expect(res.status).toBe(409)
    expect(events(mock.queries)).toHaveLength(0)
  })

  it('supersedes the matched skipper-month crew accrual by the drafted amount', async () => {
    const mock = db(
      { ...INVOICE, matched_shift_id: 'shift-1' },
      { shift: { staff_id: 'staff-1', date: '2026-08-30' }, crewAccrual: { id: 'crew-aug', amount_cents: 15000, notes: null } },
    )
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await POST(req(), params)
    expect(opArg(mock.queries, 'finance_obligations', 'update')).toMatchObject({ amount_cents: 0, status: 'cancelled' })
    expect((await res.json()).data.superseded).toMatchObject({ cancelled: true, remainingCents: 0 })
  })
})
