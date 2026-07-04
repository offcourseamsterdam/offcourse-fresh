import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import { extractVat } from '@/lib/extras/calculate'

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
  capturedInsert: null as Record<string, unknown> | null,
  insertResult: { error: null } as { error: null | { code?: string; message: string } },
}))

vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({ webhooks: { constructEvent: h.constructEvent } }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    // `table` distinguishes the assertion-relevant 'bookings' insert (captured)
    // from side-channel inserts like ops_events (best-effort, ignored here).
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: h.maybeSingle }) }),
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      insert: (row: Record<string, unknown>) => {
        if (table === 'bookings') h.capturedInsert = row
        return Promise.resolve(h.insertResult)
      },
      delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
    }),
  }),
}))
vi.mock('@/lib/ops/events', () => ({ emitOpsEvent: vi.fn().mockResolvedValue(undefined) }))
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
    h.capturedInsert = null
    h.insertResult = { error: null }
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

  // ── VAT fallback (the `0 || extractVat` trap) ───────────────────────────────
  // PI metadata VAT fields are read as `Number(meta.x) || extractVat(...)`. Since
  // 0 is falsy, a metadata VAT of '0' is OVERRIDDEN by the server recompute, while
  // a real value passes through. These pin that behaviour so a future change to the
  // fallback is a conscious decision, not a silent regression.

  const succeededMeta = {
    avail_pk: '111',
    customer_type_rate_pk: '222',
    guest_count: '2',
    category: 'private',
    listing_id: 'listing_1',
    listing_title: 'Hidden Gems Private Boat Tour',
    date: '2026-07-01',
    start_at: '2026-07-01T18:00:00+02:00',
    end_at: '2026-07-01T19:30:00+02:00',
    guest_name: 'Test Guest',
    guest_email: 'guest@example.com',
    guest_phone: '+31600000000',
    server_base_amount_cents: '15000',
  }

  function setupCreatePath() {
    h.maybeSingle.mockResolvedValue({ data: null })          // no existing booking
    h.fhValidateBooking.mockResolvedValue({ is_bookable: true })
    h.fhCreateBooking.mockResolvedValue({ uuid: 'fh-new-uuid' })
  }

  it('recomputes VAT when metadata base_vat is "0" (0 is falsy → fallback fires)', async () => {
    setupCreatePath()
    h.constructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_vat_zero', amount: 16500, metadata: { ...succeededMeta, base_vat_amount_cents: '0' } } },
    })

    const res = await POST(mockReq())

    expect(res.status).toBe(200)
    expect(h.fhCreateBooking).toHaveBeenCalledTimes(1)
    // '0' is falsy → recompute 9% of the base, NOT a stored 0.
    expect(h.capturedInsert!.base_vat_amount_cents).toBe(extractVat(15000, 9))
    expect(h.capturedInsert!.base_vat_amount_cents).not.toBe(0)
    // Claim is inserted in pending_payment with a null uuid (finalize promotes it).
    expect(h.capturedInsert!.status).toBe('pending_payment')
    expect(h.capturedInsert!.booking_uuid).toBeNull()
  })

  it('uses a real metadata base_vat value as-is (no recompute)', async () => {
    setupCreatePath()
    h.constructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_vat_real', amount: 16500, metadata: { ...succeededMeta, base_vat_amount_cents: '1239' } } },
    })

    const res = await POST(mockReq())

    expect(res.status).toBe(200)
    expect(h.capturedInsert!.base_vat_amount_cents).toBe(1239)
  })

  it('claims before creating: a lost claim (duplicate PI) never calls FareHarbor', async () => {
    h.maybeSingle.mockResolvedValue({ data: null })          // passes the existence pre-check
    h.fhValidateBooking.mockResolvedValue({ is_bookable: true })
    h.fhCreateBooking.mockResolvedValue({ uuid: 'fh-x' })
    // The claim insert loses the unique-constraint race.
    h.insertResult = { error: { code: '23505', message: 'duplicate key value' } }

    h.constructEvent.mockReturnValue({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_lost', amount: 16500, metadata: succeededMeta } },
    })

    const res = await POST(mockReq())

    expect(res.status).toBe(200)
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
