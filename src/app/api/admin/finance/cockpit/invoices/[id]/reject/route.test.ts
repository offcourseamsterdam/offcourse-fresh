import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseChainMock, has, op, opArg, type RecordedQuery } from '@/test/supabase-chain-mock'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminClient: vi.fn(),
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))

import { POST } from './route'

const ID = '11111111-1111-4111-8111-111111111111'
const BASE = `https://offcourseamsterdam.com/api/admin/finance/cockpit/invoices/${ID}/reject`

const INVOICE = { id: ID, decision: null as string | null }

function db(invoice: Record<string, unknown> | null = INVOICE) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'finance_invoices') {
      if (has(q, 'update')) return { data: { ...invoice, ...(op(q, 'update')!.args[0] as object) } }
      return { data: invoice }
    }
    if (q.table === 'finance_events') return { data: null }
    return { data: null }
  })
}

const req = (body?: unknown) => new NextRequest(BASE, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const params = { params: Promise.resolve({ id: ID }) }
const event = (queries: RecordedQuery[]) => opArg(queries, 'finance_events', 'insert') as Record<string, unknown>

describe('POST /api/admin/finance/cockpit/invoices/[id]/reject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
  })

  it('passes the requireAdmin denial through', async () => {
    h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 403 }))
    expect((await POST(req(), params)).status).toBe(403)
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
    const res = await POST(req(), params)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('already approved')
  })

  it('rejects, never creates an obligation, logs invoice_rejected', async () => {
    const mock = db()
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await POST(req({ note: 'Verkeerde skipper' }), params)
    expect(res.status).toBe(200)

    expect(opArg(mock.queries, 'finance_invoices', 'update')).toMatchObject({
      status: 'rejected',
      decision: 'rejected',
      decision_note: 'Verkeerde skipper',
    })
    expect(mock.queries.some(q => q.table === 'finance_obligations')).toBe(false)
    expect(event(mock.queries)).toMatchObject({ event_type: 'invoice_rejected', entity_type: 'invoice', entity_id: ID })
  })

  it('a note is optional', async () => {
    const mock = db()
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await POST(req(), params)
    expect(res.status).toBe(200)
    expect(opArg(mock.queries, 'finance_invoices', 'update')).toMatchObject({ decision_note: null })
  })
})
