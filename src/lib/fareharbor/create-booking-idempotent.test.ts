import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FareHarborClient } from './client'
import type { FHBookingResponse, FHBookingRequest } from './types'

/**
 * Covers createBookingIdempotent + its private findExistingBooking — the single
 * safe entry point for the money path (used by the Stripe webhook and the
 * pending-fh-sweep recovery cron). Previously untested beyond request/retry
 * plumbing in client.test.ts. A regression here either double-books a boat or
 * strands a paid customer, so every branch of the two double-booking guards is
 * covered: checkExisting-first-lookup, deterministic-vs-transient error
 * handling, voucher-exact-match priority, and the email+party-size fallback
 * (including its cancelled-booking exclusion and most-recent tie-break).
 *
 * Kept in its own file (not client.test.ts) per that file's own note: the
 * module-level rate limiter is a singleton whose clock state gets corrupted by
 * other tests' fake timers when sharing a file. These tests use real timers.
 */

function makeBooking(over: Partial<FHBookingResponse> = {}): FHBookingResponse {
  return {
    pk: 1,
    uuid: 'fh-uuid-1',
    availability: { pk: 500, start_at: '2026-08-01T15:00:00Z', end_at: '2026-08-01T16:30:00Z', item: { pk: 1, name: 'Diana' } },
    contact: { name: 'Test Guest', phone: '+31600000000', email: 'guest@example.com' },
    customers: [{ pk: 1, customer_type_rate: { pk: 1 } as never }],
    status: 'confirmed',
    is_cancelled: false,
    note: null,
    voucher_number: 'pi_test_1',
    created_at: '2026-07-01T10:00:00Z',
    ...over,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const REQUEST_DATA: FHBookingRequest = {
  contact: { name: 'Test Guest', phone: '+31600000000', email: 'guest@example.com' },
  customers: [{ customer_type_rate: 1 }],
  voucher_number: 'pi_test_1',
}

describe('FareHarborClient.createBookingIdempotent', () => {
  let listImpl: (url: string, init?: RequestInit) => Response
  let createImpl: (url: string, init?: RequestInit) => Response

  beforeEach(() => {
    vi.stubEnv('FAREHARBOR_API_APP', 'test-app')
    vi.stubEnv('FAREHARBOR_API_USER', 'test-user')
    listImpl = () => jsonResponse({ bookings: [] })
    createImpl = () => jsonResponse({ booking: makeBooking() })
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      return Promise.resolve(method === 'POST' ? createImpl(url, init) : listImpl(url, init))
    }))
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('checkExisting: true + a matching booking found by voucher_number → returns it WITHOUT calling create', async () => {
    const existing = makeBooking({ uuid: 'fh-existing', voucher_number: 'pi_test_1' })
    listImpl = () => jsonResponse({ bookings: [existing] })
    const createSpy = vi.fn(() => jsonResponse({ booking: makeBooking({ uuid: 'fh-should-not-happen' }) }))
    createImpl = createSpy

    const client = new FareHarborClient()
    const result = await client.createBookingIdempotent(500, REQUEST_DATA, '2026-08-01', { checkExisting: true })

    expect(result.uuid).toBe('fh-existing')
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('checkExisting: true + NO matching booking → proceeds to create normally', async () => {
    listImpl = () => jsonResponse({ bookings: [] })
    createImpl = () => jsonResponse({ booking: makeBooking({ uuid: 'fh-new' }) })

    const client = new FareHarborClient()
    const result = await client.createBookingIdempotent(500, REQUEST_DATA, '2026-08-01', { checkExisting: true })

    expect(result.uuid).toBe('fh-new')
  })

  it('no checkExisting + create succeeds first try → never calls the bookings-list endpoint at all', async () => {
    const listSpy = vi.fn(() => jsonResponse({ bookings: [] }))
    listImpl = listSpy
    createImpl = () => jsonResponse({ booking: makeBooking({ uuid: 'fh-new' }) })

    const client = new FareHarborClient()
    const result = await client.createBookingIdempotent(500, REQUEST_DATA, '2026-08-01')

    expect(result.uuid).toBe('fh-new')
    expect(listSpy).not.toHaveBeenCalled()
  })

  it('SECURITY: a deterministic 400 error is thrown immediately — never looked up, even if a match exists', async () => {
    createImpl = () => jsonResponse({ error: 'Invalid customer type' }, 400)
    // A matching booking DOES exist server-side, but must never be consulted for a 400.
    listImpl = () => jsonResponse({ bookings: [makeBooking({ voucher_number: 'pi_test_1' })] })
    const listSpy = vi.fn(listImpl)
    listImpl = listSpy

    const client = new FareHarborClient()
    await expect(client.createBookingIdempotent(500, REQUEST_DATA, '2026-08-01')).rejects.toThrow()
    expect(listSpy).not.toHaveBeenCalled()
  })

  it('SECURITY: a deterministic 404 error is thrown immediately — never looked up', async () => {
    createImpl = () => jsonResponse({}, 404)
    const listSpy = vi.fn(() => jsonResponse({ bookings: [] }))
    listImpl = listSpy

    const client = new FareHarborClient()
    await expect(client.createBookingIdempotent(500, REQUEST_DATA, '2026-08-01')).rejects.toThrow()
    expect(listSpy).not.toHaveBeenCalled()
  })

  it('a transient (500) error is swallowed when the booking is found afterward (create likely committed)', async () => {
    createImpl = () => jsonResponse({}, 500)
    listImpl = () => jsonResponse({ bookings: [makeBooking({ uuid: 'fh-recovered', voucher_number: 'pi_test_1' })] })

    const client = new FareHarborClient()
    const result = await client.createBookingIdempotent(500, REQUEST_DATA, '2026-08-01')

    expect(result.uuid).toBe('fh-recovered')
  })

  it('a transient (500) error is re-thrown when no matching booking is found (nothing to recover)', async () => {
    createImpl = () => jsonResponse({}, 500)
    listImpl = () => jsonResponse({ bookings: [] })

    const client = new FareHarborClient()
    await expect(client.createBookingIdempotent(500, REQUEST_DATA, '2026-08-01')).rejects.toThrow()
  })

  it('voucher_number match takes priority over an email+party-size match', async () => {
    createImpl = () => jsonResponse({}, 500)
    const byVoucher = makeBooking({ uuid: 'fh-by-voucher', voucher_number: 'pi_test_1', contact: { name: 'Other', phone: '+31600000001', email: 'other@example.com' } })
    const byEmail = makeBooking({ uuid: 'fh-by-email', voucher_number: 'different-voucher', contact: { name: 'Test Guest', phone: '+31600000000', email: 'guest@example.com' }, availability: { pk: 500, start_at: '', end_at: '', item: { pk: 1, name: 'Diana' } } })
    listImpl = () => jsonResponse({ bookings: [byEmail, byVoucher] })

    const client = new FareHarborClient()
    const result = await client.createBookingIdempotent(500, REQUEST_DATA, '2026-08-01')

    expect(result.uuid).toBe('fh-by-voucher')
  })

  it('falls back to email+availability+party-size match when FareHarbor does not echo the voucher', async () => {
    createImpl = () => jsonResponse({}, 500)
    const match = makeBooking({
      uuid: 'fh-by-email',
      voucher_number: null,
      availability: { pk: 500, start_at: '', end_at: '', item: { pk: 1, name: 'Diana' } },
      contact: { name: 'Test Guest', phone: '+31600000000', email: 'guest@example.com' },
      customers: [{ pk: 1, customer_type_rate: { pk: 1 } as never }],
    })
    listImpl = () => jsonResponse({ bookings: [match] })

    const client = new FareHarborClient()
    const result = await client.createBookingIdempotent(500, REQUEST_DATA, '2026-08-01')

    expect(result.uuid).toBe('fh-by-email')
  })

  it('SECURITY: a cancelled booking is never treated as an existing match, even with an exact voucher match', async () => {
    createImpl = () => jsonResponse({}, 500)
    listImpl = () => jsonResponse({ bookings: [makeBooking({ uuid: 'fh-cancelled', voucher_number: 'pi_test_1', is_cancelled: true })] })

    const client = new FareHarborClient()
    // No usable match (only a cancelled one) → the original 500 must surface.
    await expect(client.createBookingIdempotent(500, REQUEST_DATA, '2026-08-01')).rejects.toThrow()
  })

  it('multiple email+party-size matches (no voucher echo) → picks the MOST RECENT by created_at', async () => {
    createImpl = () => jsonResponse({}, 500)
    const older = makeBooking({
      uuid: 'fh-older', voucher_number: null, created_at: '2026-07-01T10:00:00Z',
      availability: { pk: 500, start_at: '', end_at: '', item: { pk: 1, name: 'Diana' } },
    })
    const newer = makeBooking({
      uuid: 'fh-newer', voucher_number: null, created_at: '2026-07-02T10:00:00Z',
      availability: { pk: 500, start_at: '', end_at: '', item: { pk: 1, name: 'Diana' } },
    })
    listImpl = () => jsonResponse({ bookings: [older, newer] })

    const client = new FareHarborClient()
    const result = await client.createBookingIdempotent(500, REQUEST_DATA, '2026-08-01')

    expect(result.uuid).toBe('fh-newer')
  })

  it('an empty date short-circuits findExistingBooking to no-match (never calls the list endpoint)', async () => {
    createImpl = () => jsonResponse({}, 500)
    const listSpy = vi.fn(() => jsonResponse({ bookings: [] }))
    listImpl = listSpy

    const client = new FareHarborClient()
    await expect(client.createBookingIdempotent(500, REQUEST_DATA, '')).rejects.toThrow()
    expect(listSpy).not.toHaveBeenCalled()
  })
})
