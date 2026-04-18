import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { checkRateLimit, getRateLimitHeaders } from './rate-limit'

// The rate limiter uses module-level state (a Map). Each test uses a unique
// namespace+IP combination so tests don't bleed into each other.

let counter = 0
function uniqueKey() {
  return `test-${++counter}`
}

describe('checkRateLimit', () => {
  it('allows the first request', () => {
    const ip = uniqueKey()
    expect(checkRateLimit(ip, 'session', 60, 60_000)).toBe(true)
  })

  it('allows requests up to the limit', () => {
    const ip = uniqueKey()
    const ns = uniqueKey()
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(ip, ns, 5, 60_000)).toBe(true)
    }
  })

  it('blocks the request that exceeds the limit', () => {
    const ip = uniqueKey()
    const ns = uniqueKey()
    // Consume all 5 slots
    for (let i = 0; i < 5; i++) {
      checkRateLimit(ip, ns, 5, 60_000)
    }
    // 6th request should be blocked
    expect(checkRateLimit(ip, ns, 5, 60_000)).toBe(false)
  })

  it('isolates different namespaces for the same IP', () => {
    const ip = uniqueKey()
    const ns1 = uniqueKey()
    const ns2 = uniqueKey()

    // Exhaust ns1
    for (let i = 0; i < 3; i++) checkRateLimit(ip, ns1, 3, 60_000)
    expect(checkRateLimit(ip, ns1, 3, 60_000)).toBe(false)

    // ns2 should still be allowed for the same IP
    expect(checkRateLimit(ip, ns2, 3, 60_000)).toBe(true)
  })

  it('isolates different IPs in the same namespace', () => {
    const ip1 = uniqueKey()
    const ip2 = uniqueKey()
    const ns = uniqueKey()

    // Exhaust ip1
    for (let i = 0; i < 3; i++) checkRateLimit(ip1, ns, 3, 60_000)
    expect(checkRateLimit(ip1, ns, 3, 60_000)).toBe(false)

    // ip2 should not be affected
    expect(checkRateLimit(ip2, ns, 3, 60_000)).toBe(true)
  })

  it('resets the window after windowMs has elapsed', () => {
    vi.useFakeTimers()

    const ip = uniqueKey()
    const ns = uniqueKey()

    // Exhaust the limit
    for (let i = 0; i < 2; i++) checkRateLimit(ip, ns, 2, 1_000)
    expect(checkRateLimit(ip, ns, 2, 1_000)).toBe(false)

    // Advance past the window
    vi.advanceTimersByTime(1_001)

    // Window resets — should be allowed again
    expect(checkRateLimit(ip, ns, 2, 1_000)).toBe(true)

    vi.useRealTimers()
  })

  it('treats a limit of 1 correctly (allows exactly one request)', () => {
    const ip = uniqueKey()
    const ns = uniqueKey()
    expect(checkRateLimit(ip, ns, 1, 60_000)).toBe(true)
    expect(checkRateLimit(ip, ns, 1, 60_000)).toBe(false)
  })
})

describe('getRateLimitHeaders', () => {
  it('returns full remaining count when no requests made yet', () => {
    const ip = uniqueKey()
    const ns = uniqueKey()
    const headers = getRateLimitHeaders(ip, ns, 60)
    expect(headers['X-RateLimit-Limit']).toBe('60')
    expect(headers['X-RateLimit-Remaining']).toBe('60')
  })

  it('decrements remaining as requests are made', () => {
    const ip = uniqueKey()
    const ns = uniqueKey()

    checkRateLimit(ip, ns, 10, 60_000)
    checkRateLimit(ip, ns, 10, 60_000)
    checkRateLimit(ip, ns, 10, 60_000)

    const headers = getRateLimitHeaders(ip, ns, 10)
    expect(headers['X-RateLimit-Limit']).toBe('10')
    expect(headers['X-RateLimit-Remaining']).toBe('7')
  })

  it('clamps remaining to 0 when over limit', () => {
    const ip = uniqueKey()
    const ns = uniqueKey()

    for (let i = 0; i < 15; i++) checkRateLimit(ip, ns, 5, 60_000)

    const headers = getRateLimitHeaders(ip, ns, 5)
    expect(headers['X-RateLimit-Remaining']).toBe('0')
  })
})
