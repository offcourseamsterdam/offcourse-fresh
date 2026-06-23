import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
  refundsCreate: vi.fn().mockResolvedValue({ id: 're_test_1' }),
  maybeSingle: vi.fn(),
  insert: vi.fn().mockResolvedValue({ error: null }),
  sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  notifyCateringOrder: vi.fn().mockResolvedValue(undefined),
  postSlackText: vi.fn().mockResolvedValue(undefined),
  getExtrasFromQuote: vi.fn().mockResolvedValue([]),
  claimPaymentIntent: vi.fn().mockResolvedValue('won'),
  releaseClaim: vi.fn().mockResolvedValue(undefined),
  refundsList: vi.fn().mockResolvedValue({ data: [] }),
}))

vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({
    webhooks: { constructEvent: h.constructEvent },
    refunds: { create: h.refundsCreate, list: h.refundsList },
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: h.maybeSingle }) }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      insert: h.insert,
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
vi.mock('@/lib/booking/booking-claims', () => ({
  claimPaymentIntent: h.claimPaymentIntent,
  releaseClaim: h.releaseClaim,
}))
vi.mock('@/lib/booking/recover-from-pi', () => ({
  getExtrasFromQuote: h.getExtrasFromQuote,
  // Real implementation is trivial — duplicate it so route VAT math behaves normally.
  parseMetaCents: (v: string | undefined) => {
    if (v == null || v === '') return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  },
}))

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

// ── payment_intent.succeeded — post-payment failure handling ─────────────────
//
// When a customer has PAID but FareHarbor can't complete the booking, the
// webhook must (a) wait and re-check that the browser-side flow didn't just
// create the booking, then (b) auto-refund + alert Slack. And when two paths
// race and both create FH bookings, the loser must cancel its duplicate.

describe('stripe webhook — paid-but-unbookable safety net', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test')
    // alertWebhookFailure only posts to Slack when a webhook URL is configured
    vi.stubEnv('SLACK_WEBHOOK_URL', 'https://hooks.slack.test/x')
    h.insert.mockResolvedValue({ error: null })
    h.refundsCreate.mockResolvedValue({ id: 're_test_1' })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function makePiSucceeded() {
    return {
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_unbookable',
          amount: 16500,
          metadata: {
            avail_pk: '1001',
            customer_type_rate_pk: '2002',
            guest_count: '2',
            category: 'private',
            guest_name: 'Dana Test',
            guest_email: 'dana@example.com',
            listing_title: 'Canal Cruise',
            date: '2026-06-20',
          },
        },
      },
    }
  }

  async function runWebhookThroughRecheckDelay() {
    const resPromise = POST(mockReq())
    // Skip past the 8s booking re-check delay
    await vi.advanceTimersByTimeAsync(10_000)
    return resPromise
  }

  it('auto-refunds and alerts Slack when FH validation fails and no booking exists', async () => {
    h.constructEvent.mockReturnValue(makePiSucceeded())
    // No booking row — neither at the idempotency check nor at the recheck
    h.maybeSingle.mockResolvedValue({ data: null })
    h.fhValidateBooking.mockResolvedValue({ is_bookable: false, error: 'No availability' })

    const res = await runWebhookThroughRecheckDelay()

    expect(res.status).toBe(200)
    expect(h.fhCreateBooking).not.toHaveBeenCalled()
    expect(h.refundsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: 'pi_unbookable' }),
    )
    expect(h.postSlackText).toHaveBeenCalledWith(
      expect.stringContaining('Auto-refund issued'),
    )
  })

  it('does NOT refund when the booking appears during the recheck window', async () => {
    h.constructEvent.mockReturnValue(makePiSucceeded())
    // Idempotency check: no booking yet. Recheck after the delay: booking exists
    // (the browser-side /book or /recover finished while we were validating).
    h.maybeSingle
      .mockResolvedValueOnce({ data: null })
      .mockResolvedValueOnce({ data: { id: 'booking-from-browser' } })
    h.fhValidateBooking.mockResolvedValue({ is_bookable: false, error: 'No availability' })

    const res = await runWebhookThroughRecheckDelay()

    expect(res.status).toBe(200)
    expect(h.refundsCreate).not.toHaveBeenCalled()
    expect(h.postSlackText).not.toHaveBeenCalled()
  })

  it('auto-refunds when FH createBooking throws after payment', async () => {
    h.constructEvent.mockReturnValue(makePiSucceeded())
    h.maybeSingle.mockResolvedValue({ data: null })
    h.fhValidateBooking.mockResolvedValue({ is_bookable: true })
    h.fhCreateBooking.mockRejectedValue(new Error('FH 500'))

    const res = await runWebhookThroughRecheckDelay()

    expect(res.status).toBe(200)
    expect(h.refundsCreate).toHaveBeenCalledTimes(1)
    expect(h.postSlackText).toHaveBeenCalledWith(
      expect.stringContaining('Auto-refund issued'),
    )
  })

  it('cancels its duplicate FH booking when the DB insert hits the unique constraint', async () => {
    h.constructEvent.mockReturnValue(makePiSucceeded())
    h.maybeSingle.mockResolvedValue({ data: null })
    h.fhValidateBooking.mockResolvedValue({ is_bookable: true })
    h.fhCreateBooking.mockResolvedValue({ uuid: 'fh-duplicate-uuid' })
    // Another path inserted this PI's booking first → unique violation
    h.insert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } })

    const res = await POST(mockReq())

    expect(res.status).toBe(200)
    expect(h.fhCancelBooking).toHaveBeenCalledWith('fh-duplicate-uuid')
    // The winning path already sent notifications — this one must stay silent.
    expect(h.sendConfirmationEmail).not.toHaveBeenCalled()
    expect(h.refundsCreate).not.toHaveBeenCalled()
  })
})

// ── payment_intent.succeeded — claim mutex (race prevention) ──────────────────

describe('stripe webhook — payment_intent.succeeded claim mutex', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test')
    vi.stubEnv('SLACK_WEBHOOK_URL', 'https://hooks.slack.test/x')
    h.maybeSingle.mockResolvedValue({ data: null })
    h.refundsList.mockResolvedValue({ data: [] })
    h.claimPaymentIntent.mockResolvedValue('won')
    h.fhValidateBooking.mockResolvedValue({ is_bookable: true })
    h.fhCreateBooking.mockResolvedValue({ uuid: 'fh-new' })
    h.insert.mockResolvedValue({ error: null })
  })

  function makePi() {
    return {
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_claim', amount: 16500, metadata: {
        avail_pk: '1001', customer_type_rate_pk: '2002', guest_count: '2',
        category: 'private', guest_name: 'Eve', guest_email: 'eve@example.com',
        listing_title: 'Canal Cruise', date: '2026-06-22',
      } } },
    }
  }

  it('does NOT touch FareHarbor when the claim is lost (duplicate)', async () => {
    h.constructEvent.mockReturnValue(makePi())
    h.claimPaymentIntent.mockResolvedValue('duplicate')

    const res = await POST(mockReq())

    expect(res.status).toBe(200)
    expect(h.fhValidateBooking).not.toHaveBeenCalled()
    expect(h.fhCreateBooking).not.toHaveBeenCalled()
    expect(h.refundsCreate).not.toHaveBeenCalled()
  })

  it('creates exactly one FareHarbor booking when the claim is won', async () => {
    h.constructEvent.mockReturnValue(makePi())

    const res = await POST(mockReq())

    expect(res.status).toBe(200)
    expect(h.fhCreateBooking).toHaveBeenCalledTimes(1)
    expect(h.releaseClaim).toHaveBeenCalledWith(expect.anything(), 'pi_claim')
  })

  it('does NOT book a payment that was already refunded (refund guard)', async () => {
    h.constructEvent.mockReturnValue(makePi())
    h.refundsList.mockResolvedValue({ data: [{ id: 're_1' }] })

    const res = await POST(mockReq())

    expect(res.status).toBe(200)
    expect(h.claimPaymentIntent).not.toHaveBeenCalled()
    expect(h.fhCreateBooking).not.toHaveBeenCalled()
  })

  it('redelivery after success: idempotency early-return, no claim attempted', async () => {
    h.constructEvent.mockReturnValue(makePi())
    h.maybeSingle.mockResolvedValue({ data: { id: 'existing' } })

    const res = await POST(mockReq())

    expect(res.status).toBe(200)
    expect(h.claimPaymentIntent).not.toHaveBeenCalled()
    expect(h.fhCreateBooking).not.toHaveBeenCalled()
    expect(h.reportBookingConversion).toHaveBeenCalledTimes(1)
  })

  // in_flight = another live path holds the claim. The webhook waits one recheck
  // window, then either steps aside (owner finished) or takes over (owner stalled).
  describe('in_flight recheck / takeover', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    async function runThroughRecheck() {
      const resPromise = POST(mockReq())
      await vi.advanceTimersByTimeAsync(10_000)
      return resPromise
    }

    it('steps aside (no FareHarbor) when the owner finishes during the recheck', async () => {
      h.constructEvent.mockReturnValue(makePi())
      h.claimPaymentIntent.mockResolvedValue('in_flight')
      h.maybeSingle
        .mockResolvedValueOnce({ data: null })            // idempotency
        .mockResolvedValueOnce({ data: { id: 'b-other' } }) // recheck: owner's row landed

      const res = await runThroughRecheck()

      expect(res.status).toBe(200)
      expect(h.fhCreateBooking).not.toHaveBeenCalled()
    })

    it('takes over and books when the owner stalled (no row after recheck)', async () => {
      h.constructEvent.mockReturnValue(makePi())
      h.claimPaymentIntent.mockResolvedValue('in_flight')
      h.maybeSingle.mockResolvedValue({ data: null }) // never appears

      const res = await runThroughRecheck()

      expect(res.status).toBe(200)
      expect(h.fhCreateBooking).toHaveBeenCalledTimes(1)
    })
  })
})
