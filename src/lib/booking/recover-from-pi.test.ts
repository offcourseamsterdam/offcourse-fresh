import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tests the iDEAL recovery path's safety properties:
 *   1. A PI still 'processing' at the bank returns the 'processing' outcome
 *      (with the listing slug) instead of an error — the browser parks the
 *      customer on the polling confirmation page.
 *   2. An already-refunded payment NEVER creates a booking.
 *   3. A duplicate DB insert (another path won the race) cancels our extra
 *      FareHarbor booking so the boat isn't blocked twice.
 *   4. parseMetaCents respects an explicit "0" instead of treating it as missing.
 */

const h = vi.hoisted(() => ({
  piRetrieve: vi.fn(),
  refundsList: vi.fn(),
  bookingLookup: vi.fn(),   // bookings .select().eq().not().maybeSingle()
  slugLookup: vi.fn(),      // cruise_listings .select().eq().maybeSingle()
  quoteLookup: vi.fn(),     // pricing_quotes .select().eq().maybeSingle()
  insert: vi.fn(),
  fhValidate: vi.fn(),
  fhCreate: vi.fn(),
  fhCancel: vi.fn().mockResolvedValue(undefined),
  sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  notifyCateringOrder: vi.fn().mockResolvedValue(undefined),
  postSlackText: vi.fn().mockResolvedValue(undefined),
  claimPaymentIntent: vi.fn(),
  releaseClaim: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({
    paymentIntents: { retrieve: h.piRetrieve },
    refunds: { list: h.refundsList },
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          not: () => ({ maybeSingle: h.bookingLookup }),
          maybeSingle: table === 'cruise_listings' ? h.slugLookup : h.quoteLookup,
        }),
      }),
      insert: h.insert,
    }),
  }),
}))
vi.mock('@/lib/fareharbor/client', () => ({
  getFareHarborClient: () => ({
    validateBooking: h.fhValidate,
    createBooking: h.fhCreate,
    cancelBooking: h.fhCancel,
  }),
}))
vi.mock('@/lib/booking/send-confirmation-email', () => ({ sendConfirmationEmail: h.sendConfirmationEmail }))
vi.mock('@/lib/catering/notify', () => ({ notifyCateringOrder: h.notifyCateringOrder }))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackText: h.postSlackText }))
vi.mock('./booking-claims', () => ({
  claimPaymentIntent: h.claimPaymentIntent,
  releaseClaim: h.releaseClaim,
}))

import { recoverBookingFromPi, parseMetaCents } from './recover-from-pi'

const PI_META = {
  listing_id: 'listing-1',
  listing_title: 'Canal Cruise',
  avail_pk: '1001',
  customer_type_rate_pk: '2002',
  guest_count: '2',
  category: 'private',
  date: '2026-06-20',
  guest_name: 'Eva Test',
  guest_email: 'eva@example.com',
}

describe('recoverBookingFromPi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.refundsList.mockResolvedValue({ data: [] })
    h.bookingLookup.mockResolvedValue({ data: null })
    h.slugLookup.mockResolvedValue({ data: { slug: 'canal-cruise' } })
    h.quoteLookup.mockResolvedValue({ data: null })
    h.insert.mockResolvedValue({ error: null })
    h.fhCancel.mockResolvedValue(undefined)
    h.claimPaymentIntent.mockResolvedValue('won')
  })

  it("returns the 'processing' outcome (with slug) when the payment is still settling", async () => {
    h.piRetrieve.mockResolvedValue({ id: 'pi_1', status: 'processing', metadata: PI_META })

    const result = await recoverBookingFromPi('pi_1')

    expect(result.ok).toBe(false)
    expect(result.outcome).toBe('processing')
    expect(result.listingSlug).toBe('canal-cruise')
    // Nothing irreversible may happen while the payment is unsettled
    expect(h.fhCreate).not.toHaveBeenCalled()
    expect(h.insert).not.toHaveBeenCalled()
  })

  it('refuses to create a booking for an already-refunded payment', async () => {
    h.piRetrieve.mockResolvedValue({ id: 'pi_2', status: 'succeeded', amount: 16500, metadata: PI_META })
    h.refundsList.mockResolvedValue({ data: [{ id: 're_1' }] })

    const result = await recoverBookingFromPi('pi_2')

    expect(result.ok).toBe(false)
    expect(result.outcome).toBe('failed')
    expect(result.error).toContain('refunded')
    expect(h.fhCreate).not.toHaveBeenCalled()
    expect(h.sendConfirmationEmail).not.toHaveBeenCalled()
  })

  it('cancels its duplicate FH booking when the DB insert hits the unique constraint', async () => {
    h.piRetrieve.mockResolvedValue({ id: 'pi_3', status: 'succeeded', amount: 16500, metadata: PI_META })
    h.fhValidate.mockResolvedValue({ is_bookable: true })
    h.fhCreate.mockResolvedValue({ uuid: 'fh-duplicate' })
    h.insert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } })

    const result = await recoverBookingFromPi('pi_3')

    // The other path's booking stands — report success, but with the duplicate cancelled
    expect(result.ok).toBe(true)
    expect(result.outcome).toBe('existing')
    expect(h.fhCancel).toHaveBeenCalledWith('fh-duplicate')
    // The winning path already sent the confirmation email
    expect(h.sendConfirmationEmail).not.toHaveBeenCalled()
  })

  it('returns the existing booking without touching FareHarbor (idempotency)', async () => {
    h.piRetrieve.mockResolvedValue({ id: 'pi_4', status: 'succeeded', amount: 16500, metadata: PI_META })
    h.bookingLookup.mockResolvedValue({
      data: { id: 'b1', booking_uuid: 'fh-existing', listing_id: 'listing-1' },
    })

    const result = await recoverBookingFromPi('pi_4')

    expect(result.ok).toBe(true)
    expect(result.outcome).toBe('existing')
    expect(result.fhBookingUuid).toBe('fh-existing')
    expect(h.fhCreate).not.toHaveBeenCalled()
  })

  it('creates the booking and sends Slack + email on the happy path', async () => {
    h.piRetrieve.mockResolvedValue({ id: 'pi_5', status: 'succeeded', amount: 16500, metadata: PI_META })
    h.fhValidate.mockResolvedValue({ is_bookable: true })
    h.fhCreate.mockResolvedValue({ uuid: 'fh-new' })

    const result = await recoverBookingFromPi('pi_5')

    expect(result.ok).toBe(true)
    expect(result.outcome).toBe('created')
    expect(result.fhBookingUuid).toBe('fh-new')
    expect(h.insert).toHaveBeenCalledTimes(1)
    expect(h.sendConfirmationEmail).toHaveBeenCalledTimes(1)
    expect(h.postSlackText).toHaveBeenCalledWith(
      expect.stringContaining('New booking confirmed'),
    )
    expect(h.releaseClaim).toHaveBeenCalledWith(expect.anything(), 'pi_5')
  })

  it('does NOT create a booking when the claim is a duplicate', async () => {
    h.piRetrieve.mockResolvedValue({ id: 'pi_dup', status: 'succeeded', amount: 16500, metadata: PI_META })
    h.claimPaymentIntent.mockResolvedValue('duplicate')

    const result = await recoverBookingFromPi('pi_dup')

    expect(result.ok).toBe(true)
    expect(result.outcome).toBe('existing')
    expect(h.fhValidate).not.toHaveBeenCalled()
    expect(h.fhCreate).not.toHaveBeenCalled()
  })

  it("returns 'processing' when another path holds the claim (in_flight)", async () => {
    h.piRetrieve.mockResolvedValue({ id: 'pi_inf', status: 'succeeded', amount: 16500, metadata: PI_META })
    h.claimPaymentIntent.mockResolvedValue('in_flight')

    const result = await recoverBookingFromPi('pi_inf')

    expect(result.ok).toBe(false)
    expect(result.outcome).toBe('processing')
    expect(h.fhCreate).not.toHaveBeenCalled()
  })
})

describe('parseMetaCents', () => {
  it('parses normal amounts', () => {
    expect(parseMetaCents('16500')).toBe(16500)
  })

  it('respects an explicit zero (the || fallback bug)', () => {
    expect(parseMetaCents('0')).toBe(0)
  })

  it('returns null for missing or invalid values so callers can fall back', () => {
    expect(parseMetaCents(undefined)).toBeNull()
    expect(parseMetaCents('')).toBeNull()
    expect(parseMetaCents('not-a-number')).toBeNull()
  })
})
