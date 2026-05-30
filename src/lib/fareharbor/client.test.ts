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

  it('bounds each request with an AbortSignal and converts a timeout into a typed FareHarborError', async () => {
    // Simulate AbortSignal.timeout firing: fetch rejects with a TimeoutError DOMException.
    const fetchMock = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.reject(new DOMException('The operation timed out.', 'TimeoutError'))
    )
    vi.stubGlobal('fetch', fetchMock)

    const client = new FareHarborClient()
    await expect(client.getItems()).rejects.toBeInstanceOf(FareHarborError)
    await expect(client.getItems()).rejects.toThrow(/timed out/i)

    // The request must hand fetch a signal (the 8s timeout) so it can never hang.
    const init = fetchMock.mock.calls[0]?.[1]
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('rethrows non-timeout fetch errors unchanged (does not swallow real failures)', async () => {
    const networkError = new TypeError('network failure')
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(networkError)))

    const client = new FareHarborClient()
    // getItem uses a distinct cache key; an error never populates the cache.
    await expect(client.getItem(424242)).rejects.toBe(networkError)
  })
})
