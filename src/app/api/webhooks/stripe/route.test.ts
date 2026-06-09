import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

/**
 * Tests the Stripe webhook's most consequential invariants:
 *   1. The Google Ads conversion is reported BEFORE the idempotency early-return,
 *      so card payments already booked by /book still fire a conversion.
 *   2. An already-processed PaymentIntent does NOT create a second FareHarbor
 *      booking (idempotency).
 *   3. A bad signature is rejected with 400 and does no work.
 *   4. checkout.session.completed confirms booking + sends Slack + email,
 *      with phone: null normalised to undefined.
 *   5. checkout.session.completed is idempotent: already-confirmed booking → skip.
 *   6. checkout.session.expired cancels the FH slot and marks booking cancelled.
 *   7. checkout.session.expired skips FH cancel when booking_uuid is absent.
 */

const h = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  reportBookingConversion: vi.fn().mockResolvedValue(undefined),
  reportRefundAdjustment: vi.fn().mockResolvedValue(undefined),
  fhCreateBooking: vi.fn(),
  fhValidateBooking: vi.fn(),
  fhCancelBooking: vi.fn().mockResolvedValue(undefined),
  maybeSingle: vi.fn(),
  sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  notifyCateringOrder: vi.fn().mockResolvedValue(undefined),
  postSlackText: vi.fn().mockResolvedValue(undefined),
  getExtrasFromQuote: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({ webhooks: { constructEvent: h.constructEvent } }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: h.maybeSingle }) }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      insert: () => Promise.resolve({ error: null }),
    }),
  }),
}))
vi.mock('@/lib/google-ads/report-conversion', () => ({ reportBookingConversion: h.reportBookingConversion }))
vi.mock('@/lib/google-ads/report-refund', () => ({ reportRefundAdjustment: h.reportRefundAdjustment }))
vi.mock('@/lib/fareharbor/client', () => ({
  getFareHarborClient: () => ({
    createBooking: h.fhCreateBooking,
    validateBooking: h.fhValidateBooking,
    cancelBooking: h.fhCancelBooking,
  }),
}))
vi.mock('@/lib/booking/send-confirmation-email', () => ({ sendConfirmationEmail: h.sendConfirmationEmail }))
vi.mock('@/lib/catering/notify', () => ({ notifyCateringOrder: h.notifyCateringOrder }))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackText: h.postSlackText }))
vi.mock('@/lib/booking/recover-from-pi', () => ({ getExtrasFromQuote: h.getExtrasFromQuote }))

import { POST } from './route'

function mockReq(): NextRequest {
  return {
    text: async () => 'raw-body',
    headers: { get: () => 'sig-header' },
  } as unknown as NextRequest
}

// ── payment_intent.succeeded ──────────────────────────────────────────────────

describe('stripe webhook — payment_intent.succeeded', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test')
  })

  it('fires the conversion before the idempotency early-return and does not double-book', async () => {
    h.constructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_already_booked', metadata: {} } },
    })
    // A booking already exists for this PI (browser /book ran first).
    h.maybeSingle.mockResolvedValue({ data: { id: 'existing-booking' } })

    const res = await POST(mockReq())

    expect(res.status).toBe(200)
    // Conversion must fire even though we early-return for the existing booking.
    expect(h.reportBookingConversion).toHaveBeenCalledTimes(1)
    // Must NOT create a second FareHarbor booking for an already-processed PI.
    expect(h.fhCreateBooking).not.toHaveBeenCalled()
  })

  it('rejects an invalid signature with 400 and does no work', async () => {
    h.constructEvent.mockImplementation(() => {
      throw new Error('signature verification failed')
    })

    const res = await POST(mockReq())

    expect(res.status).toBe(400)
    expect(h.reportBookingConversion).not.toHaveBeenCalled()
    expect(h.fhCreateBooking).not.toHaveBeenCalled()
  })
})

// ── checkout.session.completed ────────────────────────────────────────────────

describe('stripe webhook — checkout.session.completed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test')
  })

  function makeSession(overrides: object = {}) {
    return {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          metadata: { booking_source: 'payment_link' },
          amount_total: 16500,
          payment_intent: 'pi_test_456',
          ...overrides,
        },
      },
    }
  }

  function makePendingBooking(overrides: object = {}) {
    return {
      data: {
        id: 1,
        status: 'pending',
        booking_uuid: 'fh-uuid-abc',
        customer_name: 'Alice Test',
        customer_email: 'alice@example.com',
        customer_phone: null,
        listing_title: 'Canal Cruise',
        booking_date: '2026-06-10',
        start_time: null,
        end_time: null,
        guest_count: 2,
        base_amount_cents: 16500,
        category: 'private',
        ...overrides,
      },
    }
  }

  it('sends Slack + confirmation email, normalises null phone to undefined', async () => {
    h.constructEvent.mockReturnValue(makeSession())
    h.maybeSingle.mockResolvedValue(makePendingBooking())

    const res = await POST(mockReq())

    expect(res.status).toBe(200)
    expect(h.postSlackText).toHaveBeenCalledTimes(1)
    expect(h.sendConfirmationEmail).toHaveBeenCalledTimes(1)
    // The original bug: null phone must arrive as undefined, not null
    expect(h.sendConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        contact: expect.objectContaining({ phone: undefined }),
      }),
    )
  })

  it('skips when booking is already confirmed (idempotency)', async () => {
    h.constructEvent.mockReturnValue(makeSession())
    h.maybeSingle.mockResolvedValue(makePendingBooking({ status: 'confirmed' }))

    const res = await POST(mockReq())

    expect(res.status).toBe(200)
    expect(h.sendConfirmationEmail).not.toHaveBeenCalled()
    expect(h.postSlackText).not.toHaveBeenCalled()
  })

  it('skips sessions that are not payment_link bookings', async () => {
    h.constructEvent.mockReturnValue(
      makeSession({ metadata: { booking_source: 'other' } }),
    )

    const res = await POST(mockReq())

    expect(res.status).toBe(200)
    expect(h.sendConfirmationEmail).not.toHaveBeenCalled()
  })
})

// ── checkout.session.expired ──────────────────────────────────────────────────

describe('stripe webhook — checkout.session.expired', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test')
  })

  function makeExpiredSession() {
    return {
      type: 'checkout.session.expired',
      data: {
        object: {
          id: 'cs_expired_123',
          metadata: { booking_source: 'payment_link' },
        },
      },
    }
  }

  it('cancels the FareHarbor slot and posts a Slack note', async () => {
    h.constructEvent.mockReturnValue(makeExpiredSession())
    h.maybeSingle.mockResolvedValue({
      data: {
        id: 1,
        booking_uuid: 'fh-uuid-to-cancel',
        customer_name: 'Bob Test',
        listing_title: 'Canal Cruise',
      },
    })

    const res = await POST(mockReq())

    expect(res.status).toBe(200)
    expect(h.fhCancelBooking).toHaveBeenCalledWith('fh-uuid-to-cancel')
    expect(h.postSlackText).toHaveBeenCalledTimes(1)
  })

  it('skips FH cancel when booking has no fareharbor uuid', async () => {
    h.constructEvent.mockReturnValue(makeExpiredSession())
    h.maybeSingle.mockResolvedValue({
      data: {
        id: 1,
        booking_uuid: null,
        customer_name: 'Carol Test',
        listing_title: 'Canal Cruise',
      },
    })

    const res = await POST(mockReq())

    expect(res.status).toBe(200)
    expect(h.fhCancelBooking).not.toHaveBeenCalled()
    expect(h.postSlackText).toHaveBeenCalledTimes(1)
  })
})
