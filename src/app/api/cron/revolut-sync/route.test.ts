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
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))
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
