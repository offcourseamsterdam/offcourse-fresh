import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  requireCronSecret: vi.fn().mockReturnValue(null),
  alertCronFailure: vi.fn().mockResolvedValue(undefined),
  registerGmailWatch: vi.fn(),
}))

vi.mock('@/lib/auth/require-cron-secret', () => ({ requireCronSecret: h.requireCronSecret }))
vi.mock('@/lib/cron/alert', () => ({ alertCronFailure: h.alertCronFailure }))
vi.mock('@/lib/gmail/watch', () => ({ registerGmailWatch: h.registerGmailWatch }))

import { GET } from './route'

const req = {} as NextRequest

beforeEach(() => {
  vi.clearAllMocks()
  h.requireCronSecret.mockReturnValue(null)
})

describe('GET /api/cron/gmail-watch-renew', () => {
  it('renews the watch and returns its result', async () => {
    h.registerGmailWatch.mockResolvedValue({ historyId: '999', expiration: '1234567890000' })

    const res = await GET(req)
    const json = await res.json()

    expect(json).toEqual({ ok: true, historyId: '999', expiration: '1234567890000' })
  })

  it('alerts and returns 500 if renewal fails', async () => {
    h.registerGmailWatch.mockRejectedValue(new Error('GMAIL_PUBSUB_TOPIC not configured'))

    const res = await GET(req)

    expect(res.status).toBe(500)
    expect(h.alertCronFailure).toHaveBeenCalledWith('gmail-watch-renew', expect.any(Error))
  })

  it('rejects when the cron secret is missing', async () => {
    const denied = new Response('denied', { status: 401 })
    h.requireCronSecret.mockReturnValue(denied)

    const res = await GET(req)

    expect(res).toBe(denied)
    expect(h.registerGmailWatch).not.toHaveBeenCalled()
  })
})
