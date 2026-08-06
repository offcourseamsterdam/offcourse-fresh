import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  requireCronSecret: vi.fn(),
  syncGmailInbox: vi.fn(),
  alertCronFailure: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/auth/require-cron-secret', () => ({ requireCronSecret: h.requireCronSecret }))
vi.mock('@/lib/gmail/sync', () => ({ syncGmailInbox: h.syncGmailInbox }))
vi.mock('@/lib/cron/alert', () => ({ alertCronFailure: h.alertCronFailure }))

import { GET } from './route'

function mockReq(): NextRequest {
  return { headers: { get: () => null } } as unknown as NextRequest
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireCronSecret.mockReturnValue(null)
})

describe('GET /api/cron/gmail-inbox-sync', () => {
  it('rejects when requireCronSecret denies the request', async () => {
    const denial = new Response(null, { status: 401 }) as unknown as ReturnType<typeof Response.json>
    h.requireCronSecret.mockReturnValue(denial)

    const res = await GET(mockReq())

    expect(res).toBe(denial)
    expect(h.syncGmailInbox).not.toHaveBeenCalled()
  })

  it('returns the sync result on success', async () => {
    h.syncGmailInbox.mockResolvedValue({ imported: 3, skipped: 1 })

    const res = await GET(mockReq())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ ok: true, imported: 3, skipped: 1 })
  })

  it('alerts and returns 500 when the sync throws', async () => {
    h.syncGmailInbox.mockRejectedValue(new Error('Gmail API down'))

    const res = await GET(mockReq())
    const json = await res.json()

    expect(res.status).toBe(500)
    expect(json).toEqual({ ok: false, error: 'Gmail API down' })
    expect(h.alertCronFailure).toHaveBeenCalledWith('gmail-inbox-sync', expect.any(Error))
  })
})
