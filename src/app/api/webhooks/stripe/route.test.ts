import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

/**
 * Tests the Stripe webhook as the SINGLE booking finalizer (write-row-first):
 *   1. Happy path: insert paid_pending_fh → FareHarbor booked → flip to confirmed,
 *      send Slack + email + catering. Never refunds.
 *   2. Duplicate Stripe delivery: the row INSERT hits 23505 → exit before any
 *      FareHarbor call (the exactly-once gate that replaced the claim mutex).
 *   3. Retry-then-park: FareHarbor create fails → row stays paid_pending_fh, a
 *      CRITICAL alert fires, and `stripe.refunds.create` is NEVER called.
 *   4. Refund guard: an already-refunded PI is not (re)booked.
 *   5. The Google Ads conversion fires for every successful payment.
 *   6. checkout.session.completed / .expired behaviour (unchanged).
 *   7. A bad signature is rejected with 400 and does no work.
 */

const h = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  reportBookingConversion: vi.fn().mockResolvedValue(undefined),
  reportRefundAdjustment: vi.fn().mockResolvedValue(undefined),
  fhCreateBookingIdempotent: vi.fn(),
  fhCancelBooking: vi.fn().mockResolvedValue(undefined),
  refundsCreate: vi.fn().mockResolvedValue({ id: 're_test_1' }),
  refundsList: vi.fn().mockResolvedValue({ data: [] }),
  maybeSingle: vi.fn(),
  insert: vi.fn().mockResolvedValue({ error: null, data: { id: 'booking-row-id' } }),
  update: vi.fn().mockResolvedValue({ error: null }),
  sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  notifyCateringOrder: vi.fn().mockResolvedValue(undefined),
  sendCateringOrderEmailForBooking: vi.fn().mockResolvedValue({ ok: true, resent: false, recipient: 'x' }),
  postSlackText: vi.fn().mockResolvedValue(undefined),
  postSlackCritical: vi.fn().mockResolvedValue(undefined),
  getExtrasFromQuote: vi.fn().mockResolvedValue([]),
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
      update: () => ({ eq: h.update }),
      // Route now chains .insert(...).select('id').single() — h.insert still
      // receives the payload (for the existing call/payload assertions) and its
      // configured resolved value ({ error, data? }) is what .single() returns.
      insert: (payload: unknown) => ({
        select: () => ({ single: () => h.insert(payload) }),
      }),
    }),
  }),
}))
vi.mock('@/lib/google-ads/report-conversion', () => ({ reportBookingConversion: h.reportBookingConversion }))
vi.mock('@/lib/google-ads/report-refund', () => ({ reportRefundAdjustment: h.reportRefundAdjustment }))
vi.mock('@/lib/fareharbor/client', () => ({
  getFareHarborClient: () => ({
    createBookingIdempotent: h.fhCreateBookingIdempotent,
    cancelBooking: h.fhCancelBooking,
  }),
}))
vi.mock('@/lib/booking/send-confirmation-email', () => ({ sendConfirmationEmail: h.sendConfirmationEmail }))
vi.mock('@/lib/catering/notify', () => ({ notifyCateringOrder: h.notifyCateringOrder }))
vi.mock('@/lib/catering/send-catering-email', () => ({ sendCateringOrderEmailForBooking: h.sendCateringOrderEmailForBooking }))
vi.mock('@/lib/slack/send-notification', () => ({
  postSlackText: h.postSlackText,
  postSlackCritical: h.postSlackCritical,
}))
vi.mock('@/lib/stripe/payment-method-label', () => ({
  resolvePaymentMethodLabel: vi.fn().mockResolvedValue('card'),
}))
vi.mock('@/lib/booking/pi-metadata', () => ({
  getExtrasFromQuote: h.getExtrasFromQuote,
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

const PI_META = {
  avail_pk: '1001',
  customer_type_rate_pk: '2002',
  guest_count: '2',
  category: 'private',
  guest_name: 'Dana Test',
  guest_email: 'dana@example.com',
  listing_title: 'Canal Cruise',
  date: '2026-06-20',
  start_at: '2026-06-20T17:00:00Z',
  end_at: '2026-06-20T18:30:00Z',
}

function makePiSucceeded(overrides: object = {}) {
  return {
    type: 'payment_intent.succeeded',
    data: { object: { id: 'pi_test', amount: 16500, metadata: PI_META, ...overrides } },
  }
}

// ── payment_intent.succeeded — the single finalizer ───────────────────────────

describe('stripe webhook — payment_intent.succeeded (single finalizer)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test')
    vi.stubEnv('SLACK_WEBHOOK_URL', 'https://hooks.slack.test/x')
    h.refundsList.mockResolvedValue({ data: [] })
    h.insert.mockResolvedValue({ error: null, data: { id: 'booking-row-id' } })
    h.update.mockResolvedValue({ error: null })
    h.getExtrasFromQuote.mockResolvedValue([])
    h.sendCateringOrderEmailForBooking.mockResolvedValue({ ok: true, resent: false, recipient: 'x' })
  })

  it('write-row-first happy path: insert pending → book → confirm → notify, no refund', async () => {
    h.constructEvent.mockReturnValue(makePiSucceeded())
    h.fhCreateBookingIdempotent.mockResolvedValue({ uuid: 'fh-new' })

    const res = await POST(mockReq())

    expect(res.status).toBe(200)
    // Row written first at paid_pending_fh, then FareHarbor booked exactly once.
    expect(h.insert).toHaveBeenCalledTimes(1)
    expect(h.insert.mock.calls[0][0]).toMatchObject({ status: 'paid_pending_fh', booking_uuid: null })
    expect(h.fhCreateBookingIdempotent).toHaveBeenCalledTimes(1)
    // Flipped to confirmed + notifications fired.
    expect(h.update).toHaveBeenCalled()
    expect(h.sendConfirmationEmail).toHaveBeenCalledTimes(1)
    expect(h.notifyCateringOrder).toHaveBeenCalledTimes(1)
    // No food/drinks on this booking — nothing to auto-send to the supplier.
    expect(h.sendCateringOrderEmailForBooking).not.toHaveBeenCalled()
    // The whole point: never refunds.
    expect(h.refundsCreate).not.toHaveBeenCalled()
  })

  it('instantly auto-sends the catering email when departure is within 7 days', async () => {
    h.constructEvent.mockReturnValue(makePiSucceeded()) // PI_META.date is in the past — always within window
    h.fhCreateBookingIdempotent.mockResolvedValue({ uuid: 'fh-new' })
    h.getExtrasFromQuote.mockResolvedValue([{ name: 'Cheese Platter', category: 'food', amount_cents: 2000, extra_id: 'x' }])

    const res = await POST(mockReq())

    expect(res.status).toBe(200)
    expect(h.sendCateringOrderEmailForBooking).toHaveBeenCalledTimes(1)
    expect(h.sendCateringOrderEmailForBooking).toHaveBeenCalledWith('booking-row-id')
  })

  it('does NOT instantly auto-send catering when departure is more than 7 days out', async () => {
    h.constructEvent.mockReturnValue(makePiSucceeded({ metadata: { ...PI_META, date: '2099-01-01' } }))
    h.fhCreateBookingIdempotent.mockResolvedValue({ uuid: 'fh-new' })
    h.getExtrasFromQuote.mockResolvedValue([{ name: 'Cheese Platter', category: 'food', amount_cents: 2000, extra_id: 'x' }])

    const res = await POST(mockReq())

    expect(res.status).toBe(200)
    // Held back for the daily cron to pick up once it crosses the 7-day mark.
    expect(h.sendCateringOrderEmailForBooking).not.toHaveBeenCalled()
  })

  it('duplicate Stripe delivery: insert 23505 → exit before any FareHarbor call', async () => {
    h.constructEvent.mockReturnValue(makePiSucceeded())
    h.insert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } })

    const res = await POST(mockReq())

    expect(res.status).toBe(200)
    // The conversion still fires (once per pay), but no booking work happens.
    expect(h.reportBookingConversion).toHaveBeenCalledTimes(1)
    expect(h.fhCreateBookingIdempotent).not.toHaveBeenCalled()
    expect(h.sendConfirmationEmail).not.toHaveBeenCalled()
    expect(h.refundsCreate).not.toHaveBeenCalled()
  })

  it('retry-then-park: FareHarbor create fails → row stays parked, alert fires, NEVER refunds', async () => {
    h.constructEvent.mockReturnValue(makePiSucceeded())
    h.fhCreateBookingIdempotent.mockRejectedValue(new Error('FareHarbor request timed out after 45000ms'))

    const res = await POST(mockReq())

    expect(res.status).toBe(200)
    expect(h.insert).toHaveBeenCalledTimes(1) // the parked row was written
    expect(h.update).not.toHaveBeenCalled()   // never flipped to confirmed
    // CRITICAL alert with the "do NOT refund" instruction, and absolutely no refund.
    expect(h.postSlackCritical).toHaveBeenCalledWith(expect.stringContaining('do NOT refund'))
    expect(h.refundsCreate).not.toHaveBeenCalled()
    expect(h.sendConfirmationEmail).not.toHaveBeenCalled()
  })

  it('refund guard: an already-refunded PI is not (re)booked', async () => {
    h.constructEvent.mockReturnValue(makePiSucceeded())
    h.refundsList.mockResolvedValue({ data: [{ id: 're_1' }] })

    const res = await POST(mockReq())

    expect(res.status).toBe(200)
    expect(h.insert).not.toHaveBeenCalled()
    expect(h.fhCreateBookingIdempotent).not.toHaveBeenCalled()
  })

  it('skips payment_link PIs (handled by checkout.session.completed)', async () => {
    h.constructEvent.mockReturnValue(makePiSucceeded({ metadata: { ...PI_META, booking_source: 'payment_link' } }))

    const res = await POST(mockReq())

    expect(res.status).toBe(200)
    expect(h.insert).not.toHaveBeenCalled()
    expect(h.fhCreateBookingIdempotent).not.toHaveBeenCalled()
  })

  it('attributes campaign/partner + computes commission from PI metadata', async () => {
    h.constructEvent.mockReturnValue(makePiSucceeded({
      metadata: { ...PI_META, campaign_id: 'camp-1', partner_id: 'partner-1', server_base_amount_cents: '15000' },
    }))
    h.fhCreateBookingIdempotent.mockResolvedValue({ uuid: 'fh-new' })
    h.maybeSingle.mockResolvedValue({
      data: { percentage_value: 10, investment_type: 'percentage', partner_id: 'partner-1' },
      error: null,
    })

    const res = await POST(mockReq())

    expect(res.status).toBe(200)
    expect(h.insert.mock.calls[0][0]).toMatchObject({
      campaign_id: 'camp-1',
      partner_id: 'partner-1',
      commission_amount_cents: 1500, // 15000 * 10 / 100
    })
  })

  it('reads partner_id fresh off the campaign row, not the (possibly stale) cookie snapshot', async () => {
    // The campaign was reassigned to a different partner after the cookie was
    // set — the campaign row is the source of truth, not meta.partner_id.
    h.constructEvent.mockReturnValue(makePiSucceeded({
      metadata: { ...PI_META, campaign_id: 'camp-1', partner_id: 'stale-partner', server_base_amount_cents: '15000' },
    }))
    h.fhCreateBookingIdempotent.mockResolvedValue({ uuid: 'fh-new' })
    h.maybeSingle.mockResolvedValue({
      data: { percentage_value: 10, investment_type: 'percentage', partner_id: 'current-partner' },
      error: null,
    })

    const res = await POST(mockReq())

    expect(res.status).toBe(200)
    expect(h.insert.mock.calls[0][0]).toMatchObject({ partner_id: 'current-partner' })
  })

  it('sets campaign/partner but leaves commission null when the campaign has no valid commission config', async () => {
    h.constructEvent.mockReturnValue(makePiSucceeded({
      metadata: { ...PI_META, campaign_id: 'camp-1', partner_id: 'partner-1' },
    }))
    h.fhCreateBookingIdempotent.mockResolvedValue({ uuid: 'fh-new' })
    h.maybeSingle.mockResolvedValue({
      data: { percentage_value: null, investment_type: 'percentage', partner_id: 'partner-1' },
      error: null,
    })

    const res = await POST(mockReq())

    expect(res.status).toBe(200)
    expect(h.insert.mock.calls[0][0]).toMatchObject({
      campaign_id: 'camp-1',
      partner_id: 'partner-1',
      commission_amount_cents: null,
    })
  })

  it('leaves campaign_id/partner_id/commission null when the campaign no longer exists — never rejects the booking over a stale attribution cookie', async () => {
    // A customer can carry the oc_attr cookie for days; if an admin deletes the
    // campaign in between, bookings.campaign_id/partner_id are real FKs and
    // inserting the stale id would reject the WHOLE paid booking. Must degrade
    // to unattributed instead.
    h.constructEvent.mockReturnValue(makePiSucceeded({
      metadata: { ...PI_META, campaign_id: 'deleted-campaign', partner_id: 'partner-1' },
    }))
    h.fhCreateBookingIdempotent.mockResolvedValue({ uuid: 'fh-new' })
    h.maybeSingle.mockResolvedValue({ data: null, error: null })

    const res = await POST(mockReq())

    expect(res.status).toBe(200)
    expect(h.insert.mock.calls[0][0]).toMatchObject({
      campaign_id: null,
      partner_id: null,
      commission_amount_cents: null,
    })
  })

  it('leaves campaign/partner/commission null for organic bookings (no campaign_id in metadata)', async () => {
    h.constructEvent.mockReturnValue(makePiSucceeded())
    h.fhCreateBookingIdempotent.mockResolvedValue({ uuid: 'fh-new' })

    const res = await POST(mockReq())

    expect(res.status).toBe(200)
    // No campaign_id in metadata → never even queries the campaigns table.
    expect(h.maybeSingle).not.toHaveBeenCalled()
    expect(h.insert.mock.calls[0][0]).toMatchObject({
      campaign_id: null,
      partner_id: null,
      commission_amount_cents: null,
    })
  })

  it('rejects an invalid signature with 400 and does no work', async () => {
    h.constructEvent.mockImplementation(() => {
      throw new Error('signature verification failed')
    })

    const res = await POST(mockReq())

    expect(res.status).toBe(400)
    expect(h.reportBookingConversion).not.toHaveBeenCalled()
    expect(h.fhCreateBookingIdempotent).not.toHaveBeenCalled()
  })
})

// ── checkout.session.completed ────────────────────────────────────────────────

describe('stripe webhook — checkout.session.completed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test')
    h.update.mockResolvedValue({ error: null })
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
    expect(h.sendConfirmationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ contact: expect.objectContaining({ phone: undefined }) }),
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
    h.constructEvent.mockReturnValue(makeSession({ metadata: { booking_source: 'other' } }))

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
    h.update.mockResolvedValue({ error: null })
  })

  function makeExpiredSession() {
    return {
      type: 'checkout.session.expired',
      data: { object: { id: 'cs_expired_123', metadata: { booking_source: 'payment_link' } } },
    }
  }

  it('cancels the FareHarbor slot and posts a Slack note', async () => {
    h.constructEvent.mockReturnValue(makeExpiredSession())
    h.maybeSingle.mockResolvedValue({
      data: { id: 1, booking_uuid: 'fh-uuid-to-cancel', customer_name: 'Bob Test', listing_title: 'Canal Cruise' },
    })

    const res = await POST(mockReq())

    expect(res.status).toBe(200)
    expect(h.fhCancelBooking).toHaveBeenCalledWith('fh-uuid-to-cancel')
    expect(h.postSlackText).toHaveBeenCalledTimes(1)
  })

  it('skips FH cancel when booking has no fareharbor uuid', async () => {
    h.constructEvent.mockReturnValue(makeExpiredSession())
    h.maybeSingle.mockResolvedValue({
      data: { id: 1, booking_uuid: null, customer_name: 'Carol Test', listing_title: 'Canal Cruise' },
    })

    const res = await POST(mockReq())

    expect(res.status).toBe(200)
    expect(h.fhCancelBooking).not.toHaveBeenCalled()
    expect(h.postSlackText).toHaveBeenCalledTimes(1)
  })
})
