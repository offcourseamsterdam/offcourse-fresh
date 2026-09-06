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
const VALID_IBAN = 'NL91ABNA0417164300'
const CONNECTED_ROW = { id: 'default', refresh_token_enc: 'enc', consented_at: '2026-08-01T00:00:00.000Z', account_id: 'acct-1' }

const OBLIGATION = {
  id: ID, title: 'Ligplaats jachthaven', amount_cents: 45000, status: 'open', revolut_draft_id: null as string | null,
  supplier: { id: 'sup-1', name: 'Jachthaven Westerdok', iban: VALID_IBAN, revolut_counterparty_id: null as string | null },
}

// The route mutates the fetched row in place (`obligation.revolut_draft_id = draftId`) to build its
// response — harmless with Supabase's fresh-per-request objects, but a shared literal object here
// would leak that mutation into every later test. Clone on every call.
function db(obligation: Record<string, unknown> | null = { ...OBLIGATION, supplier: OBLIGATION.supplier ? { ...OBLIGATION.supplier } : null }) {
  return createSupabaseChainMock((q: RecordedQuery) => {
    if (q.table === 'finance_obligations') {
      if (has(q, 'update')) return { data: null }
      return { data: obligation }
    }
    if (q.table === 'finance_suppliers' && has(q, 'update')) return { data: null }
    return { data: null }
  })
}

const post = () => POST(new NextRequest(`https://offcourseamsterdam.com/api/admin/finance/cockpit/obligations/${ID}/draft-payment`, { method: 'POST' }), { params: Promise.resolve({ id: ID }) })

describe('POST /obligations/[id]/draft-payment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.requireAdmin.mockResolvedValue(null)
    h.createAdminClient.mockImplementation(() => db().client)
    h.loadConnection.mockResolvedValue(CONNECTED_ROW)
    h.createRevolutClient.mockResolvedValue({
      createCounterparty: vi.fn().mockResolvedValue({ id: 'cp-1' }),
      createPaymentDraft: vi.fn().mockResolvedValue({ id: 'draft-1' }),
    })
  })

  it('denied admin never reaches the obligation', async () => {
    h.requireAdmin.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await post()).status).toBe(401)
  })

  it('404 on an unknown obligation, 409 on one already paid or cancelled', async () => {
    h.createAdminClient.mockImplementation(() => db(null).client)
    expect((await post()).status).toBe(404)
    h.createAdminClient.mockImplementation(() => db({ ...OBLIGATION, status: 'paid' }).client)
    expect((await post()).status).toBe(409)
  })

  it('the happy path: creates a counterparty and draft, pins the draft id, never marks the obligation paid', async () => {
    const mock = db()
    h.createAdminClient.mockImplementation(() => mock.client)
    const res = await post()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.revolut_draft_id).toBe('draft-1')
    expect(opArg(mock.queries, 'finance_obligations', 'update')).toMatchObject({ revolut_draft_id: 'draft-1' })
    // Never a status change — drafting is not paying.
    expect(opArg(mock.queries, 'finance_obligations', 'update')).not.toHaveProperty('status')
  })

  it('a second click is idempotent: the pinned draft is reused, no new counterparty or draft is created', async () => {
    const mock = db({ ...OBLIGATION, revolut_draft_id: 'draft-existing' })
    h.createAdminClient.mockImplementation(() => mock.client)
    const client = { createCounterparty: vi.fn(), createPaymentDraft: vi.fn() }
    h.createRevolutClient.mockResolvedValue(client)
    const res = await post()
    expect((await res.json()).data.revolut_draft_id).toBe('draft-existing')
    expect(client.createCounterparty).not.toHaveBeenCalled()
    expect(client.createPaymentDraft).not.toHaveBeenCalled()
  })

  it('refuses with no supplier linked, no IBAN, or a bad checksum — never reaching Revolut', async () => {
    const client = { createCounterparty: vi.fn(), createPaymentDraft: vi.fn() }
    h.createRevolutClient.mockResolvedValue(client)
    h.createAdminClient.mockImplementation(() => db({ ...OBLIGATION, supplier: null }).client)
    expect((await post()).status).toBe(409)
    h.createAdminClient.mockImplementation(() => db({ ...OBLIGATION, supplier: { ...OBLIGATION.supplier, iban: null } }).client)
    expect((await post()).status).toBe(409)
    h.createAdminClient.mockImplementation(() => db({ ...OBLIGATION, supplier: { ...OBLIGATION.supplier, iban: 'NL91ABNA0417164301' } }).client)
    expect((await post()).status).toBe(409)
    expect(client.createCounterparty).not.toHaveBeenCalled()
  })

  it('refuses when Revolut is not connected or has no account selected', async () => {
    h.loadConnection.mockResolvedValue({ id: 'default', refresh_token_enc: null, consented_at: null, account_id: null })
    expect((await post()).status).toBe(400)
    h.loadConnection.mockResolvedValue({ ...CONNECTED_ROW, account_id: null })
    expect((await post()).status).toBe(400)
  })
})
