import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseChainMock, has, op, type RecordedQuery } from '@/test/supabase-chain-mock'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminClient: vi.fn(),
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))

import { GET } from './route'

const ID = '11111111-1111-4111-8111-111111111111'
const BASE = `https://offcourseamsterdam.com/api/admin/inbox/conversations/${ID}`

const CONVERSATION = {
  id: ID,
  channel: 'email',
  status: 'open',
  subject: 'Factuur',
  unread_count: 0,
  last_message_at: '2026-09-01T00:00:00.000Z',
  created_at: '2026-09-01T00:00:00.000Z',
  booking_id: null,
  wa_window_expires_at: null,
  ota_source: null,
  ota_status: null,
  ota_booking_ref: null,
  ota_guest_name: null,
  source_category: null as string | null,
  contact: null,
}

const MESSAGE_ROWS = [{ id: 'msg-1' }, { id: 'msg-2' }]

const FINANCE_INVOICE_ROW = {
  id: 'inv-1',
  status: 'ready',
  file_path: 'email/gmail-1/factuur.pdf',
  extracted: { invoiceNumber: 'INV-1' },
  checks: [{ key: 'iban', ok: true, detail: 'IBAN komt overeen' }],
  supplier: { id: 'sup-1', name: 'Mare', iban: 'NL01TEST0123456789' },
}

function db(conversation: Record<string, unknown> | null, financeInvoiceRows: Record<string, unknown>[] = []) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'conversations') {
      if (has(q, 'update')) return { data: null }
      return { data: conversation }
    }
    if (q.table === 'messages') {
      const selectArg = op(q, 'select')?.args[0] as string | undefined
      // loadFinanceInvoices selects just 'id'; the main thread-messages query selects a much longer column list.
      if (selectArg === 'id') return { data: MESSAGE_ROWS }
      return { data: [] }
    }
    if (q.table === 'agent_proposals') return { data: [] }
    if (q.table === 'finance_invoices') return { data: financeInvoiceRows }
    return { data: null }
  })
}

const req = () => new NextRequest(BASE)
const params = { params: Promise.resolve({ id: ID }) }

describe('GET /api/admin/inbox/conversations/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
  })

  it('passes the requireAdmin denial through', async () => {
    h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
    expect((await GET(req(), params)).status).toBe(401)
  })

  it('returns 404 when the conversation does not exist', async () => {
    h.createAdminClient.mockReturnValue(db(null).client)
    expect((await GET(req(), params)).status).toBe(404)
  })

  it('a normal (non-finance) conversation gets an empty financeInvoices list, never queries finance_invoices', async () => {
    const mock = db({ ...CONVERSATION, source_category: null }, [FINANCE_INVOICE_ROW])
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await GET(req(), params)
    const { data } = await res.json()
    expect(data.financeInvoices).toEqual([])
    expect(mock.queries.some(q => q.table === 'finance_invoices')).toBe(false)
  })

  it('a source_category=finance conversation loads its finance_invoices, scoped to this thread\'s message ids', async () => {
    const mock = db({ ...CONVERSATION, source_category: 'finance' }, [FINANCE_INVOICE_ROW])
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await GET(req(), params)
    const { data } = await res.json()
    expect(data.financeInvoices).toEqual([FINANCE_INVOICE_ROW])

    const invoiceQuery = mock.queries.find(q => q.table === 'finance_invoices')!
    expect(op(invoiceQuery, 'in')?.args).toEqual(['source_message_id', ['msg-1', 'msg-2']])
  })

  it('a finance conversation with no messages yet skips the finance_invoices query entirely', async () => {
    const mock = createSupabaseChainMock((q: RecordedQuery) => {
      if (q.table === 'conversations') return { data: { ...CONVERSATION, source_category: 'finance' } }
      if (q.table === 'messages') return { data: [] }
      if (q.table === 'agent_proposals') return { data: [] }
      return { data: null }
    })
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await GET(req(), params)
    const { data } = await res.json()
    expect(data.financeInvoices).toEqual([])
    expect(mock.queries.some(q => q.table === 'finance_invoices')).toBe(false)
  })
})
