import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FareHarborClient } from './client'
import { FareHarborError } from './types'

/**
 * Guards the request timeout added to the FareHarbor client. Without a timeout a
 * hung FH connection blocks the booking request (and the Stripe webhook) forever;
 * the webhook hang would then trigger Stripe retries → duplicate booking attempts.
 */
describe('FareHarborClient request timeout', () => {
  beforeEach(() => {
    vi.stubEnv('FAREHARBOR_API_APP', 'test-app')
    vi.stubEnv('FAREHARBOR_API_USER', 'test-user')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('retries a GET timeout (reads are safe) then converts it to a typed 408 FareHarborError', async () => {
    vi.useFakeTimers()
    // Simulate AbortSignal.timeout firing: fetch rejects with a TimeoutError DOMException.
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'))
    )
    vi.stubGlobal('fetch', fetchMock)

    const client = new FareHarborClient()
    const p = client.getItems()
    p.catch(() => {}) // avoid unhandled-rejection warning while timers advance
    await vi.runAllTimersAsync() // drive the 1s/2s/4s backoff sleeps

    await expect(p).rejects.toBeInstanceOf(FareHarborError)
    await expect(p).rejects.toThrow(/timed out/i)
    // initial attempt + MAX_RETRIES(3) retries = 4 fetches for a safe GET
    expect(fetchMock).toHaveBeenCalledTimes(4)
    // The request must hand fetch an AbortSignal so it can never hang.
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
    vi.useRealTimers()
  })

  it('rethrows a non-timeout network error unchanged after exhausting retries (does not swallow real failures)', async () => {
    vi.useFakeTimers()
    const networkError = new TypeError('network failure')
    const fetchMock = vi.fn(() => Promise.reject(networkError))
    vi.stubGlobal('fetch', fetchMock)

    const client = new FareHarborClient()
    const p = client.getItem(424242) // distinct cache key; an error never caches
    p.catch(() => {})
    await vi.runAllTimersAsync()

    await expect(p).rejects.toBe(networkError)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    vi.useRealTimers()
  })
})
