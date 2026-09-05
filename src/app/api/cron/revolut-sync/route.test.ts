import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  loadConnection: vi.fn(),
  createRevolutClient: vi.fn(),
  getRevolutEnvConfig: vi.fn(),
  syncRevolut: vi.fn(),
  postSlackOps: vi.fn(),
  alertCronFailure: vi.fn(),
  ensureExpensesForTransactions: vi.fn(),
  syncRevolutExpenses: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))
const { MATCH_TALLY } = vi.hoisted(() => ({ MATCH_TALLY: { attached: 1, attached_partial: 0, review: 0, none: 0, skipped: 0 } }))
vi.mock('@/lib/finance/expenses/match-orchestrator', () => ({ matchOrphanDocuments: vi.fn().mockResolvedValue(MATCH_TALLY) }))
vi.mock('@/lib/finance/expenses/sync-revolut', () => ({
  ensureExpensesForTransactions: h.ensureExpensesForTransactions,
  syncRevolutExpenses: h.syncRevolutExpenses,
}))
vi.mock('@/lib/revolut/token-store', () => ({
  loadConnection: h.loadConnection,
  isConnected: (row: { refresh_token_enc?: string | null; consented_at?: string | null }) => Boolean(row.refresh_token_enc && row.consented_at),
  createRevolutClient: h.createRevolutClient,
  getRevolutEnvConfig: h.getRevolutEnvConfig,
}))
vi.mock('@/lib/revolut/sync', () => ({ syncRevolut: h.syncRevolut }))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackOps: h.postSlackOps }))
vi.mock('@/lib/cron/alert', () => ({ alertCronFailure: h.alertCronFailure }))

import { GET } from './route'

const req = (auth?: string) => new NextRequest('https://offcourseamsterdam.com/api/cron/revolut-sync', { headers: auth ? { authorization: auth } : {} })

describe('GET /api/cron/revolut-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'cron-secret'
    h.createAdminClient.mockReturnValue({})
    h.getRevolutEnvConfig.mockReturnValue({ environment: 'sandbox' })
    h.loadConnection.mockResolvedValue({ refresh_token_enc: 'enc', consented_at: '2026-09-01', last_sync_error: null })
    h.createRevolutClient.mockResolvedValue({})
  })

  it('requires the cron secret', async () => {
    expect((await GET(req())).status).toBe(401)
    expect((await GET(req('Bearer wrong'))).status).toBe(401)
    expect(h.syncRevolut).not.toHaveBeenCalled()
  })

  it('skips quietly when Revolut is not connected', async () => {
    h.loadConnection.mockResolvedValue({ refresh_token_enc: null, consented_at: null })
    const res = await GET(req('Bearer cron-secret'))
    expect(await res.json()).toEqual({ ok: true, skipped: 'not_connected' })
    expect(h.syncRevolut).not.toHaveBeenCalled()
  })

  it('runs the sync and reports counts', async () => {
    h.syncRevolut.mockResolvedValue({ ok: true, fetched: 12, upserted: 12, stateChanges: [], balanceCents: 5248000 })
    const res = await GET(req('Bearer cron-secret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, fetched: 12, balanceCents: 5248000 })
    expect(h.postSlackOps).not.toHaveBeenCalled()
  })

  it('after a successful sync, creates expense records and pulls Revolut expenses over the same 30-day window', async () => {
    h.syncRevolut.mockResolvedValue({ ok: true, accountId: 'acct-1', fetched: 3, upserted: 3, stateChanges: [], balanceCents: 1 })
    h.ensureExpensesForTransactions.mockResolvedValue({ scanned: 3, created: 2, ignored: 1 })
    h.syncRevolutExpenses.mockResolvedValue({ expensesSeen: 2, linked: 2, receiptsStored: 1, orphanReceipts: 0, skippedReceipts: 0, extractionFailures: 0 })

    const res = await GET(req('Bearer cron-secret'))
    const body = await res.json()
    expect(body.expenses).toEqual({
      matched: MATCH_TALLY,
      ensured: { scanned: 3, created: 2, ignored: 1 },
      synced: { expensesSeen: 2, linked: 2, receiptsStored: 1, orphanReceipts: 0, skippedReceipts: 0, extractionFailures: 0 },
    })
    const [, ensureOpts] = h.ensureExpensesForTransactions.mock.calls[0]
    expect(ensureOpts.accountId).toBe('acct-1')
    const sinceMs = Date.parse(ensureOpts.since)
    // 30 days (was 7): a cron outage or a transfer pending longer than a week must still get its Expense Record; `.is('expense_id', null)` bounds the work.
    expect(Date.now() - sinceMs).toBeGreaterThan(29.9 * 86_400_000)
    expect(Date.now() - sinceMs).toBeLessThan(30.1 * 86_400_000)
    expect(h.syncRevolutExpenses.mock.calls[0][2].since).toBe(ensureOpts.since)
  })

  it('an expense-step failure never fails the cash sync — it is reported, not thrown', async () => {
    h.syncRevolut.mockResolvedValue({ ok: true, accountId: 'acct-1', fetched: 0, upserted: 0, stateChanges: [] })
    h.ensureExpensesForTransactions.mockRejectedValue(new Error('expenses endpoint 500'))
    const res = await GET(req('Bearer cron-secret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, expenses: { error: 'expenses endpoint 500' } })
    expect(h.alertCronFailure).not.toHaveBeenCalled()
  })

  it('skips the expense step when the sync did not resolve an account', async () => {
    h.syncRevolut.mockResolvedValue({ ok: true, skipped: 'no_account', fetched: 0, upserted: 0, stateChanges: [] })
    await GET(req('Bearer cron-secret'))
    expect(h.ensureExpensesForTransactions).not.toHaveBeenCalled()
  })

  it('alerts Beer once when a healthy connection starts failing, not on every retry', async () => {
    h.syncRevolut.mockResolvedValue({ ok: false, error: 'Revolut GET /accounts failed (500)', fetched: 0, upserted: 0, stateChanges: [] })
    expect((await GET(req('Bearer cron-secret'))).status).toBe(502)
    expect(h.postSlackOps).toHaveBeenCalledTimes(1)
    expect(h.postSlackOps.mock.calls[0][0]).toContain('Revolut-synchronisatie mislukt')

    h.loadConnection.mockResolvedValue({ refresh_token_enc: 'enc', consented_at: '2026-09-01', last_sync_error: 'already failing' })
    await GET(req('Bearer cron-secret'))
    expect(h.postSlackOps).toHaveBeenCalledTimes(1)
  })

  it('routes unexpected exceptions through alertCronFailure', async () => {
    h.createRevolutClient.mockRejectedValue(new Error('no key'))
    const res = await GET(req('Bearer cron-secret'))
    expect(res.status).toBe(500)
    expect(h.alertCronFailure).toHaveBeenCalledWith('revolut-sync', expect.any(Error))
  })
})
