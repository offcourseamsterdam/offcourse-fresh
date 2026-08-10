import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { NextRequest } from 'next/server'
import { requirePubsubSecret } from './require-pubsub-secret'

function makeRequest(url: string): NextRequest {
  return { nextUrl: new URL(url) } as unknown as NextRequest
}

const ORIGINAL_SECRET = process.env.GMAIL_PUSH_WEBHOOK_SECRET

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.GMAIL_PUSH_WEBHOOK_SECRET
  else process.env.GMAIL_PUSH_WEBHOOK_SECRET = ORIGINAL_SECRET
})

describe('requirePubsubSecret', () => {
  it('rejects when GMAIL_PUSH_WEBHOOK_SECRET is not configured, even with a token present', async () => {
    delete process.env.GMAIL_PUSH_WEBHOOK_SECRET
    const res = requirePubsubSecret(makeRequest('https://x.com/api/webhooks/gmail-push?token=anything'))
    expect(res?.status).toBe(401)
  })

  it('rejects a missing token', () => {
    process.env.GMAIL_PUSH_WEBHOOK_SECRET = 'secret123'
    const res = requirePubsubSecret(makeRequest('https://x.com/api/webhooks/gmail-push'))
    expect(res?.status).toBe(401)
  })

  it('rejects a wrong token', () => {
    process.env.GMAIL_PUSH_WEBHOOK_SECRET = 'secret123'
    const res = requirePubsubSecret(makeRequest('https://x.com/api/webhooks/gmail-push?token=wrong'))
    expect(res?.status).toBe(401)
  })

  it('allows the correct token', () => {
    process.env.GMAIL_PUSH_WEBHOOK_SECRET = 'secret123'
    const res = requirePubsubSecret(makeRequest('https://x.com/api/webhooks/gmail-push?token=secret123'))
    expect(res).toBeNull()
  })
})
