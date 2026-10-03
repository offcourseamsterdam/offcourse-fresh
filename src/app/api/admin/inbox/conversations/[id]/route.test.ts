import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseChainMock, has, op, opArg, queriesFor, type RecordedQuery } from '@/test/supabase-chain-mock'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  createAdminClient: vi.fn(),
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))

import { GET, PATCH } from './route'

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

function db(conversation: Record<string, unknown> | null, financeInvoiceRows: Record<string, unknown>[] = [], messageRows: Record<string, unknown>[] = []) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'conversations') {
      if (has(q, 'update')) return { data: null }
      return { data: conversation }
    }
    if (q.table === 'messages') return { data: messageRows }
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

describe('GET /api/admin/inbox/conversations/[id] — read state and reply doorman', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
  })

  it('never marks the thread read — the 5s poll and hover-prefetch must not undo "Mark unread"', async () => {
    const mock = db({ ...CONVERSATION, unread_count: 2 })
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await GET(req(), params)
    expect(res.status).toBe(200)
    expect(queriesFor(mock.queries, 'conversations', 'update')).toHaveLength(0)
  })

  it("turns each message's stored triage into a small view, and tolerates rows without one", async () => {
    const mock = db(CONVERSATION, [], [
      { id: 'm1', direction: 'in', body: 'hi', reply_triage: { v: 1, verdict: 'no', source: 'ai', signals: [], ai_verdict: 'no', ai_reason: 'Newsletter', at: '2026-10-03T00:00:00Z' } },
      { id: 'm2', direction: 'out', body: 'yo', reply_triage: null },
      { id: 'm3', direction: 'in', body: 'odd', reply_triage: { v: 9 } },
    ])
    h.createAdminClient.mockReturnValue(mock.client)
    const { data } = await (await GET(req(), params)).json()
    expect(data.messages.map((m: { reply_triage: unknown }) => m.reply_triage)).toEqual([{ verdict: 'no', reason: 'Newsletter' }, null, null])
  })
})

describe('PATCH /api/admin/inbox/conversations/[id]', () => {
  const patch = (body: unknown) => new NextRequest(BASE, { method: 'PATCH', body: JSON.stringify(body) })

  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
  })

  it('passes the requireAdmin denial through', async () => {
    h.requireAdmin.mockResolvedValueOnce(NextResponse.json({ ok: false }, { status: 401 }))
    expect((await PATCH(patch({ status: 'resolved' }), params)).status).toBe(401)
  })

  it('still changes the workflow status', async () => {
    const mock = db(CONVERSATION)
    h.createAdminClient.mockReturnValue(mock.client)
    expect((await PATCH(patch({ status: 'resolved' }), params)).status).toBe(200)
    expect(opArg(mock.queries, 'conversations', 'update')).toEqual({ status: 'resolved' })
  })

  it('mark unread sets one unread message, only if it is currently read (keeps a real higher count)', async () => {
    const mock = db(CONVERSATION)
    h.createAdminClient.mockReturnValue(mock.client)
    expect((await PATCH(patch({ unread: true }), params)).status).toBe(200)
    const [q] = queriesFor(mock.queries, 'conversations', 'update')
    expect(op(q, 'update')?.args[0]).toEqual({ unread_count: 1 })
    expect(q.ops.filter(o => o.method === 'eq').map(o => o.args)).toEqual([['id', ID], ['unread_count', 0]])
  })

  it('mark read clears the count unconditionally', async () => {
    const mock = db(CONVERSATION)
    h.createAdminClient.mockReturnValue(mock.client)
    expect((await PATCH(patch({ unread: false }), params)).status).toBe(200)
    const [q] = queriesFor(mock.queries, 'conversations', 'update')
    expect(op(q, 'update')?.args[0]).toEqual({ unread_count: 0 })
    expect(q.ops.filter(o => o.method === 'eq').map(o => o.args)).toEqual([['id', ID]])
  })

  it('rejects bad input without touching the database', async () => {
    const mock = db(CONVERSATION)
    h.createAdminClient.mockReturnValue(mock.client)
    for (const body of [{}, null, 'resolved', { status: 'done' }, { unread: 'yes' }, { status: 'resolved', unread: 1 }]) {
      expect((await PATCH(patch(body), params)).status).toBe(400)
    }
    expect(mock.queries).toHaveLength(0)
  })

  it('surfaces a database error instead of pretending it saved', async () => {
    const mock = createSupabaseChainMock(() => ({ error: { message: 'boom' } }))
    h.createAdminClient.mockReturnValue(mock.client)
    const res = await PATCH(patch({ unread: true }), params)
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
