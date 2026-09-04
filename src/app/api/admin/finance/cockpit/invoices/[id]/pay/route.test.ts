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

const INVOICE = {
  id: ID,
  status: 'ready',
  decision: null as string | null,
  expected_amount_cents: 15000,
  extracted: { invoiceNumber: 'INV-1', invoiceDate: '2026-09-01', amountCents: 15000 },
  supplier: { id: 'sup-1', name: 'Mare', iban: 'NL01TEST0123456789', default_boat_id: 'boat-1', revolut_counterparty_id: null as string | null },
}

function db(invoice: Record<string, unknown> | null = INVOICE, obligationId = 'ob-1') {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'finance_invoices') {
      if (has(q, 'update')) return { data: { ...invoice, ...(op(q, 'update')!.args[0] as object) } }
      return { data: invoice }
    }
    if (q.table === 'finance_obligations' && has(q, 'insert')) return { data: { id: obligationId } }
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
const event = (queries: RecordedQuery[]) => opArg(queries, 'finance_events', 'insert') as Record<string, unknown>

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
    h.createAdminClient.mockReturnValue(db({ ...INVOICE, expected_amount_cents: null, extracted: { ...INVOICE.extracted, amountCents: null } }).client)
    const res = await POST(req(), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('No amount')
  })

  it('refuses when the supplier has no known IBAN', async () => {
    h.createAdminClient.mockReturnValue(db({ ...INVOICE, supplier: { ...INVOICE.supplier, iban: null } }).client)
    const res = await POST(req(), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('IBAN')
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

  it('creates a counterparty on first use, an obligation, and a payment draft; moves to payment_pending', async () => {
    const mock = db()
    h.createAdminClient.mockReturnValue(mock.client)
    const cpMock = vi.fn().mockResolvedValue({ id: 'cp-new' })
    const draftMock = vi.fn().mockResolvedValue({ id: 'draft-new' })
    h.createRevolutClient.mockResolvedValue(revolutClient({ createCounterparty: cpMock, createPaymentDraft: draftMock }))

    const res = await POST(req(), params)
    expect(res.status).toBe(200)

    expect(cpMock).toHaveBeenCalledWith({ company_name: 'Mare', bank_country: 'NL', currency: 'EUR', iban: 'NL01TEST0123456789' })
    expect(opArg(mock.queries, 'finance_suppliers', 'update')).toEqual({ revolut_counterparty_id: 'cp-new' })

    const obligation = opArg(mock.queries, 'finance_obligations', 'insert') as Record<string, unknown>
    expect(obligation).toMatchObject({ title: 'Factuur Mare #INV-1', kind: 'invoice', amount_cents: 15000, boat_id: 'boat-1', invoice_id: ID })

    expect(draftMock).toHaveBeenCalledWith({
      title: 'Factuur Mare #INV-1',
      payments: [{ account_id: 'acct-1', receiver: { counterparty_id: 'cp-new' }, amount: 150, currency: 'EUR', reference: 'Factuur Mare #INV-1' }],
    })

    const update = opArg(mock.queries, 'finance_invoices', 'update') as Record<string, unknown>
    expect(update).toMatchObject({ status: 'payment_pending', decision: 'approved', obligation_id: 'ob-1', revolut_draft_id: 'draft-new' })

    expect(event(mock.queries)).toMatchObject({ event_type: 'invoice_payment_drafted', entity_type: 'invoice', entity_id: ID, delta_cents: 15000 })
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
    expect(opArg(mock.queries, 'finance_invoices', 'update')).toMatchObject({ decision: 'approved_override' })
  })
})
