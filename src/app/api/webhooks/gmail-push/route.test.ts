import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  requirePubsubSecret: vi.fn().mockReturnValue(null),
  syncGmailInbox: vi.fn().mockResolvedValue({ imported: 0, skipped: 0 }),
  alertCronFailure: vi.fn().mockResolvedValue(undefined),
  afterCallbacks: [] as Array<() => unknown>,
}))

vi.mock('@/lib/auth/require-pubsub-secret', () => ({ requirePubsubSecret: h.requirePubsubSecret }))
vi.mock('@/lib/gmail/sync', () => ({ syncGmailInbox: h.syncGmailInbox }))
vi.mock('@/lib/cron/alert', () => ({ alertCronFailure: h.alertCronFailure }))
vi.mock('next/server', async () => {
  const actual = await vi.importActual('next/server')
  return { ...actual, after: (cb: () => unknown) => h.afterCallbacks.push(cb) }
})

import { POST } from './route'

const req = {} as NextRequest

beforeEach(() => {
  vi.clearAllMocks()
  h.requirePubsubSecret.mockReturnValue(null)
  h.syncGmailInbox.mockResolvedValue({ imported: 0, skipped: 0 })
  h.afterCallbacks.length = 0
})

describe('POST /api/webhooks/gmail-push', () => {
  it('acks immediately with 200 and defers the sync to after()', async () => {
    const res = await POST(req)
    const json = await res.json()

    expect(json).toEqual({ ok: true })
    expect(h.syncGmailInbox).not.toHaveBeenCalled() // not called synchronously — only queued via after()
    expect(h.afterCallbacks).toHaveLength(1)
  })

  it('running the deferred callback triggers syncGmailInbox', async () => {
    await POST(req)
    await h.afterCallbacks[0]()

    expect(h.syncGmailInbox).toHaveBeenCalledTimes(1)
  })

  it('alerts (but does not throw) if the deferred sync fails', async () => {
    h.syncGmailInbox.mockRejectedValue(new Error('Gmail API down'))

    await POST(req)
    await h.afterCallbacks[0]()

    expect(h.alertCronFailure).toHaveBeenCalledWith('gmail-push', expect.any(Error))
  })

  it('rejects when the pubsub secret check fails', async () => {
    const denied = new Response('denied', { status: 401 })
    h.requirePubsubSecret.mockReturnValue(denied)

    const res = await POST(req)

    expect(res).toBe(denied)
    expect(h.afterCallbacks).toHaveLength(0)
  })
})
