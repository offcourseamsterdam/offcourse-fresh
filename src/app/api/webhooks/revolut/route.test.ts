import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { randomBytes } from 'node:crypto'
import { createSupabaseChainMock, has, op } from '@/test/supabase-chain-mock'
import { encryptSecret } from '@/lib/revolut/crypto'
import { computeRevolutSignature } from '@/lib/revolut/webhook-signature'

const h = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  loadConnection: vi.fn(),
  createRevolutClient: vi.fn(),
  getTransaction: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))
vi.mock('@/lib/revolut/token-store', () => ({
  loadConnection: h.loadConnection,
  isConnected: (row: { refresh_token_enc?: string | null; consented_at?: string | null }) => Boolean(row.refresh_token_enc && row.consented_at),
  createRevolutClient: h.createRevolutClient,
}))

import { POST } from './route'

const KEY = randomBytes(32).toString('base64')
const SECRET = 'wsk_r59a4HfWVAKycbCaNO1RvgCJec02gRd8'
const TIMESTAMP = '1683650202360'
const BODY = '{"data":{"id":"645a7696-22f3-aa47-9c74-cbae0449cc46","new_state":"completed","old_state":"pending","request_id":"app_charges-9f5d5eb3-1e06-46c5-b1c0-3914763e0bcb"},"event":"TransactionStateChanged","timestamp":"2023-05-09T16:36:38.028960Z"}'
const SIGNATURE = 'v1=bca326fb378d0da7f7c490ad584a8106bab9723d8d9cdd0d50b4c5b3be3837c0'

const TX = {
  id: '645a7696-22f3-aa47-9c74-cbae0449cc46', type: 'transfer', state: 'completed',
  created_at: '2023-05-09T16:30:00Z', updated_at: '2023-05-09T16:36:38Z', completed_at: '2023-05-09T16:36:38Z',
  reference: 'Invoice #184',
  legs: [{ leg_id: 'l1', account_id: 'acc-main', amount: -450, currency: 'EUR', description: 'To Jansen Marine', balance: 52030 }],
}

function connection(over: Record<string, unknown> = {}) {
  return { id: 'default', refresh_token_enc: 'enc', consented_at: '2026-09-01T00:00:00Z', account_id: 'acc-main', webhook_secret_enc: encryptSecret(SECRET, Buffer.from(KEY, 'base64')), ...over }
}

function request(body = BODY, headers: Record<string, string> = { 'revolut-signature': SIGNATURE, 'revolut-request-timestamp': TIMESTAMP }) {
  return new NextRequest('https://offcourseamsterdam.com/api/webhooks/revolut', { method: 'POST', body, headers })
}

describe('POST /api/webhooks/revolut', () => {
  let db: ReturnType<typeof createSupabaseChainMock>
  let insertError: { message: string; code?: string } | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Number(TIMESTAMP) + 5_000))
    process.env.REVOLUT_TOKEN_KEY = KEY
    insertError = null
    db = createSupabaseChainMock(q => {
      if (q.table === 'revolut_webhook_events' && has(q, 'insert')) return { error: insertError }
      return { data: null }
    })
    h.createAdminClient.mockReturnValue(db.client)
    h.loadConnection.mockResolvedValue(connection())
    h.getTransaction.mockResolvedValue(TX)
    h.createRevolutClient.mockResolvedValue({ getTransaction: h.getTransaction })
  })
  afterEach(() => { vi.useRealTimers() })

  it('rejects a bad signature with 401 and touches nothing', async () => {
    const res = await POST(request(BODY, { 'revolut-signature': 'v1=00', 'revolut-request-timestamp': TIMESTAMP }))
    expect(res.status).toBe(401)
    expect(db.queries.some(q => q.table === 'revolut_webhook_events')).toBe(false)
    expect(h.getTransaction).not.toHaveBeenCalled()
  })

  it('rejects a stale timestamp (replay)', async () => {
    vi.setSystemTime(new Date(Number(TIMESTAMP) + 10 * 60_000))
    const res = await POST(request())
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'stale_timestamp' })
  })

  it('answers 503 when no webhook secret is stored yet', async () => {
    h.loadConnection.mockResolvedValue(connection({ webhook_secret_enc: null }))
    expect((await POST(request())).status).toBe(503)
  })

  it('verifies, records, re-fetches the transaction, upserts it and snapshots the balance', async () => {
    const res = await POST(request())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, processed: true, state: 'completed', change: 'pending→completed' })

    const evtInsert = db.queries.find(q => q.table === 'revolut_webhook_events' && has(q, 'insert'))!
    expect(op(evtInsert, 'insert')!.args[0]).toMatchObject({ event_type: 'TransactionStateChanged', transaction_id: TX.id })

    expect(h.getTransaction).toHaveBeenCalledWith(TX.id)
    const upsert = db.queries.find(q => q.table === 'bank_transactions' && has(q, 'upsert'))!
    expect(op(upsert, 'upsert')!.args[0]).toMatchObject({ revolut_id: TX.id, amount_cents: -45000, state: 'completed', account_id: 'acc-main' })
    expect(op(upsert, 'upsert')!.args[1]).toEqual({ onConflict: 'revolut_id' })

    const snap = db.queries.find(q => q.table === 'revolut_balance_snapshots' && has(q, 'insert'))!
    expect(op(snap, 'insert')!.args[0]).toMatchObject({ balance_cents: 5203000, source: 'webhook', account_id: 'acc-main' })

    const processed = db.queries.find(q => q.table === 'revolut_webhook_events' && has(q, 'update'))!
    expect(op(processed, 'update')!.args[0]).toHaveProperty('processed_at')
  })

  it('treats a duplicate delivery as already handled (unique violation → 200, no fetch)', async () => {
    insertError = { message: 'duplicate key value violates unique constraint', code: '23505' }
    const res = await POST(request())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, duplicate: true })
    expect(h.getTransaction).not.toHaveBeenCalled()
  })

  it('never trusts the payload: a signed event for a transaction on another account is recorded but not upserted', async () => {
    h.getTransaction.mockResolvedValue({ ...TX, legs: [{ ...TX.legs[0], account_id: 'someone-else' }] })
    const res = await POST(request())
    expect(await res.json()).toMatchObject({ ok: true, processed: false })
    expect(db.queries.some(q => q.table === 'bank_transactions')).toBe(false)
  })

  it('defers to the sync cron (still 200) when Revolut cannot be reached', async () => {
    h.getTransaction.mockRejectedValue(new Error('boom'))
    const res = await POST(request())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, processed: false, error: 'deferred_to_sync' })
    const errUpdate = db.queries.find(q => q.table === 'revolut_webhook_events' && has(q, 'update'))!
    expect(op(errUpdate, 'update')!.args[0]).toMatchObject({ error: 'boom' })
  })

  it('a re-serialised body fails verification even with a correct secret', async () => {
    const pretty = JSON.stringify(JSON.parse(BODY), null, 2)
    const res = await POST(request(pretty))
    expect(res.status).toBe(401)
    // sanity: signing the pretty body ourselves would pass — proving the check is body-exact
    const ok = await POST(request(pretty, { 'revolut-signature': computeRevolutSignature(SECRET, TIMESTAMP, pretty), 'revolut-request-timestamp': TIMESTAMP }))
    expect(ok.status).toBe(200)
  })
})
