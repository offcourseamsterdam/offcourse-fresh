import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({ createAdminClient: vi.fn(), forwardReadyExpenses: vi.fn(), alertCronFailure: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: h.createAdminClient }))
vi.mock('@/lib/finance/expenses/forward-snelstart', () => ({ forwardReadyExpenses: h.forwardReadyExpenses }))
vi.mock('@/lib/cron/alert', () => ({ alertCronFailure: h.alertCronFailure }))

import { GET } from './route'

const req = (auth?: string) => new NextRequest('https://offcourseamsterdam.com/api/cron/finance-snelstart-forward', { headers: auth ? { authorization: auth } : {} })

describe('GET /api/cron/finance-snelstart-forward', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'cron-secret'
    h.createAdminClient.mockReturnValue({})
  })

  it('rejects a missing or wrong cron secret without touching the mailbox', async () => {
    expect((await GET(req())).status).toBe(401)
    expect((await GET(req('Bearer nope'))).status).toBe(401)
    expect(h.forwardReadyExpenses).not.toHaveBeenCalled()
  })

  it('runs the forwarding pass and returns its tally', async () => {
    h.forwardReadyExpenses.mockResolvedValue({ enabled: true, considered: 2, sent: 2, failed: [] })
    const res = await GET(req('Bearer cron-secret'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, enabled: true, considered: 2, sent: 2, failed: [] })
  })

  it('a crash of the pass is a cron alert and a 500, never a silent success', async () => {
    h.forwardReadyExpenses.mockRejectedValue(new Error('db down'))
    const res = await GET(req('Bearer cron-secret'))
    expect(res.status).toBe(500)
    expect(h.alertCronFailure).toHaveBeenCalledWith('finance-snelstart-forward', expect.any(Error))
  })
})
