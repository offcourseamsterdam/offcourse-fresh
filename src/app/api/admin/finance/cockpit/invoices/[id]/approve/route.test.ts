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
  extracted: {
    invoiceNumber: 'INV-1',
    invoiceDate: '2026-09-01',
    supplierName: 'Mare',
    amountCents: 15000,
  },
  supplier: { id: 'sup-1', name: 'Mare', default_boat_id: 'boat-1' },
}

function db(invoice: Record<string, unknown> | null = INVOICE, obligationId = 'ob-1') {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'finance_invoices') {
      if (has(q, 'update')) return { data: { ...invoice, ...(op(q, 'update')!.args[0] as object) } }
      return { data: invoice }
    }
    if (q.table === 'finance_obligations' && has(q, 'insert')) return { data: { id: obligationId } }
    if (q.table === 'finance_events') return { data: null }
    return { data: null }
  })
}

const req = (body?: unknown) => new NextRequest(BASE, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const params = { params: Promise.resolve({ id: ID }) }
const event = (queries: RecordedQuery[]) => opArg(queries, 'finance_events', 'insert') as Record<string, unknown>

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

  it('refuses when there is no amount to approve', async () => {
    h.createAdminClient.mockReturnValue(db({ ...INVOICE, expected_amount_cents: null, extracted: { ...INVOICE.extracted, amountCents: null } }).client)
    const res = await POST(req(), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('No amount')
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

    const update = opArg(mock.queries, 'finance_invoices', 'update') as Record<string, unknown>
    expect(update).toMatchObject({ status: 'approved', decision: 'approved', obligation_id: 'ob-1' })

    expect(event(mock.queries)).toMatchObject({ event_type: 'invoice_approved', entity_type: 'invoice', entity_id: ID, delta_cents: 15000 })
  })

  it('a needs_review invoice approves as an override, never silently as a clean approval', async () => {
    const mock = db({ ...INVOICE, status: 'needs_review' })
    h.createAdminClient.mockReturnValue(mock.client)
    await POST(req(), params)
    expect(opArg(mock.queries, 'finance_invoices', 'update')).toMatchObject({ decision: 'approved_override' })
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
    expect(opArg(mock.queries, 'finance_invoices', 'update')).toMatchObject({ decision_note: 'Beer approved by phone' })
  })
})
