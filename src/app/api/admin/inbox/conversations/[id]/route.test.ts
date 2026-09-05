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

// The DB row loadFinanceInvoices() reads — includes the `message` join column
// and the raw `iban`, both stripped out before the API response.
const FINANCE_INVOICE_DB_ROW = {
  id: 'inv-1',
  status: 'ready',
  file_path: 'email/gmail-1/uuid.pdf',
  original_filename: 'factuur.pdf',
  extracted: { invoiceNumber: 'INV-1' },
  checks: [{ key: 'iban', ok: true, detail: 'IBAN komt overeen' }],
  supplier: { id: 'sup-1', name: 'Mare', iban: 'NL01TEST0123456789' },
  message: { conversation_id: ID },
}

// What the API response should actually contain — has_iban, never the IBAN, and no `message` echo.
const FINANCE_INVOICE_ROW = {
  id: 'inv-1',
  status: 'ready',
  file_path: 'email/gmail-1/uuid.pdf',
  original_filename: 'factuur.pdf',
  extracted: { invoiceNumber: 'INV-1' },
  checks: [{ key: 'iban', ok: true, detail: 'IBAN komt overeen' }],
  supplier: { id: 'sup-1', name: 'Mare', has_iban: true },
}

function db(conversation: Record<string, unknown> | null, financeInvoiceRows: Record<string, unknown>[] = []) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'conversations') {
      if (has(q, 'update')) return { data: null }
      return { data: conversation }
    }
    if (q.table === 'messages') return { data: [] }
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
    const mock = db({ ...CONVERSATION, source_category: null }, [FINANCE_INVOICE_DB_ROW])
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await GET(req(), params)
    const { data } = await res.json()
    expect(data.financeInvoices).toEqual([])
    expect(mock.queries.some(q => q.table === 'finance_invoices')).toBe(false)
  })

  it('a source_category=finance conversation loads its finance_invoices, filtered through the message join — never a preliminary unbounded message-id fetch', async () => {
    const mock = db({ ...CONVERSATION, source_category: 'finance' }, [FINANCE_INVOICE_DB_ROW])
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await GET(req(), params)
    const { data } = await res.json()
    expect(data.financeInvoices).toEqual([FINANCE_INVOICE_ROW])

    const invoiceQuery = mock.queries.find(q => q.table === 'finance_invoices')!
    expect(op(invoiceQuery, 'eq')?.args).toEqual(['message.conversation_id', ID])
    expect(op(invoiceQuery, 'limit')?.args).toEqual([10])
    // Exactly one `messages` query — the thread's own message list. No second,
    // preliminary `select('id')` against `messages` just to build an id list
    // for finance_invoices (that was the unbounded-growth shape being fixed).
    expect(mock.queries.filter(q => q.table === 'messages')).toHaveLength(1)
  })

  it('never leaks the raw IBAN into the response, even though the DB row carries one', async () => {
    const mock = db({ ...CONVERSATION, source_category: 'finance' }, [FINANCE_INVOICE_DB_ROW])
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await GET(req(), params)
    const { data } = await res.json()
    expect(JSON.stringify(data.financeInvoices)).not.toContain('NL01TEST')
  })

  it('a finance conversation with no matching invoices yet gets an empty list', async () => {
    const mock = db({ ...CONVERSATION, source_category: 'finance' }, [])
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await GET(req(), params)
    const { data } = await res.json()
    expect(data.financeInvoices).toEqual([])
  })
})
