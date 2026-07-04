import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractVat } from '@/lib/extras/calculate'

/**
 * recover-from-pi.ts is the manual rescue tool run during incidents (and the
 * webhook safety net). Two things must hold:
 *   - getExtrasFromQuote parses the stored quote breakdown correctly (it feeds
 *     both the confirmation email and the booking row).
 *   - recoverBookingFromPi is idempotent (existing booking → no second FH booking)
 *     and, when it does recover, writes the booking with the right VAT fallback.
 */

const h = vi.hoisted(() => ({
  results: {} as Record<string, { data: unknown }>,
  capturedInsert: null as Record<string, unknown> | null,
  piRetrieve: vi.fn(),
  fhValidate: vi.fn(),
  fhCreate: vi.fn(),
  sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  notifyCateringOrder: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({ paymentIntents: { retrieve: h.piRetrieve } }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        not: () => builder,
        maybeSingle: () => Promise.resolve(h.results[table] ?? { data: null }),
        insert: (row: Record<string, unknown>) => {
          if (table === 'bookings') h.capturedInsert = row
          return Promise.resolve({ error: null })
        },
      }
      return builder
    },
  }),
}))
vi.mock('@/lib/fareharbor/client', () => ({
  getFareHarborClient: () => ({ validateBooking: h.fhValidate, createBooking: h.fhCreate }),
}))
vi.mock('@/lib/booking/send-confirmation-email', () => ({ sendConfirmationEmail: h.sendConfirmationEmail }))
vi.mock('@/lib/catering/notify', () => ({ notifyCateringOrder: h.notifyCateringOrder }))

import { getExtrasFromQuote, recoverBookingFromPi } from './recover-from-pi'

beforeEach(() => {
  vi.clearAllMocks()
  h.results = {}
  h.capturedInsert = null
})

describe('getExtrasFromQuote', () => {
  it('returns [] when no quoteId is given (no DB call needed)', async () => {
    expect(await getExtrasFromQuote(undefined)).toEqual([])
  })

  it('returns [] when the quote has no breakdown', async () => {
    h.results.pricing_quotes = { data: { breakdown: null } }
    expect(await getExtrasFromQuote('q1')).toEqual([])
  })

  it('maps line items and drops zero/blank/no-price entries', async () => {
    h.results.pricing_quotes = {
      data: {
        breakdown: {
          extrasCalculation: {
            line_items: [
              { name: 'Unlimited Drinks', amount_cents: 3000, category: 'drinks', extra_id: 'e1', quantity: 2, vat_rate: 21, vat_amount_cents: 521 },
              { name: 'Free thing', amount_cents: 0 },          // dropped: amount 0
              { name: '', amount_cents: 1000 },                  // dropped: blank name
              { amount_cents: 500 },                             // dropped: no name
            ],
          },
        },
      },
    }

    const extras = await getExtrasFromQuote('q1')

    expect(extras).toHaveLength(1)
    expect(extras[0]).toEqual({
      name: 'Unlimited Drinks',
      amount_cents: 3000,
      category: 'drinks',
      extra_id: 'e1',
      quantity: 2,
      vat_rate: 21,
      vat_amount_cents: 521,
    })
  })

  it('swallows DB errors and returns [] (never throws during an incident)', async () => {
    // No pricing_quotes result configured AND the breakdown access path is safe.
    expect(await getExtrasFromQuote('missing')).toEqual([])
  })
})

describe('recoverBookingFromPi', () => {
  function makePi(metaOver: Record<string, string> = {}) {
    return {
      id: 'pi_recover',
      status: 'succeeded',
      amount: 16500,
      metadata: {
        avail_pk: '111',
        customer_type_rate_pk: '222',
        guest_count: '2',
        category: 'private',
        listing_id: 'listing_1',
        listing_title: 'Hidden Gems Private Boat Tour',
        date: '2026-07-01',
        guest_name: 'Test Guest',
        guest_email: 'guest@example.com',
        server_base_amount_cents: '15000',
        ...metaOver,
      },
    } as never
  }

  it('is idempotent — an existing booking returns outcome "existing" and never calls FareHarbor', async () => {
    h.results.bookings = { data: { id: 'b1', booking_uuid: 'fh-existing', listing_id: 'listing_1' } }
    h.results.cruise_listings = { data: { slug: 'hidden-gems' } }

    const result = await recoverBookingFromPi(makePi())

    expect(result.outcome).toBe('existing')
    expect(result.fhBookingUuid).toBe('fh-existing')
    expect(result.listingSlug).toBe('hidden-gems')
    expect(h.fhCreate).not.toHaveBeenCalled()
  })

  it('bails out when the PaymentIntent has not succeeded', async () => {
    const result = await recoverBookingFromPi({ id: 'pi_x', status: 'requires_payment_method', metadata: {} } as never)
    expect(result.ok).toBe(false)
    expect(result.outcome).toBe('failed')
    expect(h.fhCreate).not.toHaveBeenCalled()
  })

  it('creates the booking and writes the recovery row with the VAT fallback', async () => {
    h.results.bookings = { data: null }              // no existing booking
    h.results.cruise_listings = { data: { slug: 'hidden-gems' } }
    h.results.pricing_quotes = { data: { breakdown: null } }
    h.fhValidate.mockResolvedValue({ is_bookable: true })
    h.fhCreate.mockResolvedValue({ uuid: 'fh-new-uuid' })

    const result = await recoverBookingFromPi(makePi())

    expect(result.outcome).toBe('created')
    expect(result.fhBookingUuid).toBe('fh-new-uuid')
    // FareHarbor validate ran before create.
    expect(h.fhValidate.mock.invocationCallOrder[0]).toBeLessThan(h.fhCreate.mock.invocationCallOrder[0])
    // The recovery row was written with the computed VAT fallback (no meta VAT given → 9% of base).
    expect(h.capturedInsert).toBeTruthy()
    expect(h.capturedInsert!.base_vat_amount_cents).toBe(extractVat(15000, 9))
    expect(h.capturedInsert!.booking_uuid).toBe('fh-new-uuid')
    expect(h.capturedInsert!.stripe_payment_intent_id).toBe('pi_recover')
    // Private booking → exactly one FareHarbor customer entry regardless of guest count.
    expect(h.fhCreate).toHaveBeenCalledWith(111, expect.objectContaining({
      customers: [{ customer_type_rate: 222 }],
    }))
  })

  it('returns failed (no insert) when FareHarbor says the slot is not bookable', async () => {
    h.results.bookings = { data: null }
    h.fhValidate.mockResolvedValue({ is_bookable: false, error: 'Sold out' })

    const result = await recoverBookingFromPi(makePi())

    expect(result.ok).toBe(false)
    expect(result.outcome).toBe('failed')
    expect(h.fhCreate).not.toHaveBeenCalled()
    expect(h.capturedInsert).toBeNull()
  })
})
