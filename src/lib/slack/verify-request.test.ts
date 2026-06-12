import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHmac } from 'crypto'
import { verifySlackSignature } from './verify-request'

const SECRET = 'test-signing-secret'

/** Build a valid Slack signature for body+timestamp the way Slack does. */
function sign(body: string, timestamp: string, secret = SECRET): string {
  return 'v0=' + createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')
}

const BODY = 'command=%2Fcheckin&user_id=U123'

describe('verifySlackSignature', () => {
  beforeEach(() => {
    vi.stubEnv('SLACK_SIGNING_SECRET', SECRET)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-12T12:00:00Z'))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  function nowTs(): string {
    return String(Math.floor(Date.now() / 1000))
  }

  it('accepts a correctly signed, fresh request', () => {
    const ts = nowTs()
    expect(verifySlackSignature(BODY, ts, sign(BODY, ts))).toBe(true)
  })

  it('rejects a tampered body', () => {
    const ts = nowTs()
    expect(verifySlackSignature(BODY + '&evil=1', ts, sign(BODY, ts))).toBe(false)
  })

  it('rejects a signature made with the wrong secret', () => {
    const ts = nowTs()
    expect(verifySlackSignature(BODY, ts, sign(BODY, ts, 'wrong-secret'))).toBe(false)
  })

  it('rejects a replayed request older than 5 minutes', () => {
    const old = String(Math.floor(Date.now() / 1000) - 301)
    expect(verifySlackSignature(BODY, old, sign(BODY, old))).toBe(false)
  })

  it('accepts a request just inside the 5-minute window', () => {
    const ts = String(Math.floor(Date.now() / 1000) - 299)
    expect(verifySlackSignature(BODY, ts, sign(BODY, ts))).toBe(true)
  })

  it('rejects when timestamp or signature is missing', () => {
    const ts = nowTs()
    expect(verifySlackSignature(BODY, null, sign(BODY, ts))).toBe(false)
    expect(verifySlackSignature(BODY, ts, null)).toBe(false)
  })

  it('rejects a malformed signature without throwing (timingSafeEqual length guard)', () => {
    expect(verifySlackSignature(BODY, nowTs(), 'v0=short')).toBe(false)
  })

  it('fails closed when SLACK_SIGNING_SECRET is not configured', () => {
    vi.stubEnv('SLACK_SIGNING_SECRET', '')
    const ts = nowTs()
    expect(verifySlackSignature(BODY, ts, sign(BODY, ts))).toBe(false)
  })
})
