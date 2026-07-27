import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FareHarborClient } from './client'

/**
 * Guards the `rebooking` link on validateBooking(). Without it, FareHarbor's validate
 * endpoint rejects a reschedule onto any slot that conflicts with the customer's own
 * existing booking on the same resource ("Unable to satisfy resources") — even though
 * the actual create call (rebookBooking) would succeed once the link tells FareHarbor
 * to release the original booking's resource first.
 *
 * Kept in its own file: the module-level rate limiter in client.ts is a singleton whose
 * clock state gets corrupted by other tests' fake timers when sharing a file, causing
 * unrelated real-time waits here.
 */
describe('FareHarborClient.validateBooking rebooking link', () => {
  beforeEach(() => {
    vi.stubEnv('FAREHARBOR_API_APP', 'test-app')
    vi.stubEnv('FAREHARBOR_API_USER', 'test-user')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('omits the rebooking field when no original booking UUID is given', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ is_bookable: true }), { status: 200 }))
    )
    vi.stubGlobal('fetch', fetchMock)

    const client = new FareHarborClient()
    await client.validateBooking(123, { contact: { name: 'A', email: 'a@b.com', phone: '+31600000000' }, customers: [{ customer_type_rate: 1 }] })

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)
    expect(body).not.toHaveProperty('rebooking')
  })

  it('includes the rebooking field with the original booking UUID when rescheduling', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ is_bookable: true }), { status: 200 }))
    )
    vi.stubGlobal('fetch', fetchMock)

    const client = new FareHarborClient()
    await client.validateBooking(
      123,
      { contact: { name: 'A', email: 'a@b.com', phone: '+31600000000' }, customers: [{ customer_type_rate: 1 }] },
      'original-booking-uuid'
    )

    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)
    expect(body.rebooking).toBe('original-booking-uuid')
  })
})
