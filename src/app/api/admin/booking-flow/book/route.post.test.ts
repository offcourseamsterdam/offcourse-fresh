import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * POST-level tests for the booking finalize handler. The public website no longer
 * reaches /book (the Stripe webhook is the sole finalizer there) and the claim mutex
 * is gone; what remains for /book's surviving callers (admin / internal / recovery):
 *   - the happy path validates + books + saves;
 *   - an existing row for the PI returns deduplicated WITHOUT calling FareHarbor;
 *   - a 23505 on save cancels our FareHarbor booking and stays silent (handled race);
 *   - a genuine (non-23505) save failure fires the CRITICAL repair alert.
 */

const h = vi.hoisted(() => ({
  fhValidate: vi.fn().mockResolvedValue({ is_bookable: true }),
  fhCreate: vi.fn().mockResolvedValue({ uuid: 'fh-new' }),
  fhCancel: vi.fn().mockResolvedValue(undefined),
  maybeSingle: vi.fn().mockResolvedValue({ data: null }),
  insert: vi.fn().mockResolvedValue({ error: null }),
  // Default = a legit settled payment whose metadata matches WEBSITE_BODY, so the
  // website payment gate passes. Negative cases below override per test.
  piRetrieve: vi.fn().mockResolvedValue({
    status: 'succeeded',
    metadata: { avail_pk: '1001', customer_type_rate_pk: '2002', guest_count: '2' },
  }),
  resolveCustomerTypeName: vi.fn().mockResolvedValue(null),
  describeCustomerTypes: vi.fn().mockResolvedValue(null),
  sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  notifyCateringOrder: vi.fn().mockResolvedValue(undefined),
  sendCateringOrderEmailForBooking: vi.fn().mockResolvedValue({ ok: true, resent: false, recipient: 'x' }),
  notifyBookingFailure: vi.fn().mockResolvedValue(undefined),
  postSlackText: vi.fn().mockResolvedValue(undefined),
  postSlackCritical: vi.fn().mockResolvedValue(undefined),
  requireAdmin: vi.fn().mockResolvedValue(null),
  // 'promo_codes' lookup for the isAuthorizedByFullPromo check — independent of the
  // generic 'bookings'/other-table mock below. Defaults to "no such code" (not found).
  promoMaybeSingle: vi.fn().mockResolvedValue({ data: null }),
}))

vi.mock('@/lib/fareharbor/client', () => ({
  getFareHarborClient: () => ({
    validateBooking: h.fhValidate,
    createBooking: h.fhCreate,
    cancelBooking: h.fhCancel,
  }),
}))
vi.mock('@/lib/fareharbor/customer-type-name', () => ({
  resolveCustomerTypeName: h.resolveCustomerTypeName,
  describeCustomerTypes: h.describeCustomerTypes,
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      // Only 'promo_codes' (the new isAuthorizedByFullPromo check) gets its own mock —
      // every other table keeps the exact prior shared behavior, unchanged.
      if (table === 'promo_codes') {
        return { select: () => ({ eq: () => ({ maybeSingle: h.promoMaybeSingle }) }) }
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: h.maybeSingle, single: h.maybeSingle }) }),
        // saveToSupabase now chains .insert(...).select('id').single() — h.insert
        // still receives the payload (existing call/payload assertions keep working)
        // and its configured resolved value ({ error, data? }) is what .single() returns.
        insert: (payload: unknown) => ({
          select: () => ({ single: () => h.insert(payload) }),
        }),
      }
    },
  }),
}))
vi.mock('@/lib/stripe/server', () => ({ getStripe: () => ({ paymentIntents: { retrieve: h.piRetrieve } }) }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/booking/send-confirmation-email', () => ({ sendConfirmationEmail: h.sendConfirmationEmail }))
vi.mock('@/lib/catering/notify', () => ({ notifyCateringOrder: h.notifyCateringOrder }))
vi.mock('@/lib/catering/send-catering-email', () => ({ sendCateringOrderEmailForBooking: h.sendCateringOrderEmailForBooking }))
vi.mock('@/lib/booking/notify-booking-failure', () => ({ notifyBookingFailure: h.notifyBookingFailure }))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackText: h.postSlackText, postSlackCritical: h.postSlackCritical }))

import { POST } from './route'

function mockReq(body: object): NextRequest {
  return {
    json: async () => body,
    cookies: { get: () => undefined },
  } as unknown as NextRequest
}

const WEBSITE_BODY = {
  availPk: 1001,
  customerTypeRatePk: 2002,
  guestCount: 2,
  category: 'shared',
  contact: { name: 'Test Guest', email: 't@example.com', phone: '+31600000000' },
  listingId: 'l1',
  listingTitle: 'Canal Cruise',
  date: '2026-06-22',
  startAt: '2026-06-22T15:00:00Z',
  endAt: '2026-06-22T16:30:00Z',
  amountCents: 7000,
  stripePaymentIntentId: 'pi_book_1',
  baseAmountCents: 7000,
  extrasAmountCents: 0,
  totalVatAmountCents: 578,
  bookingSource: 'website',
}

describe('POST /book — finalize (no claim mutex)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SLACK_WEBHOOK_URL', 'https://hooks.slack.test/x')
    h.maybeSingle.mockResolvedValue({ data: null })
    h.insert.mockResolvedValue({ error: null, data: { id: 'booking-row-id' } })
    h.fhValidate.mockResolvedValue({ is_bookable: true })
    h.fhCreate.mockResolvedValue({ uuid: 'fh-new' })
    h.sendCateringOrderEmailForBooking.mockResolvedValue({ ok: true, resent: false, recipient: 'x' })
    // Restore the "legit settled payment" default each test (clearAllMocks keeps
    // implementations, but a negative test may have overridden it).
    h.piRetrieve.mockResolvedValue({
      status: 'succeeded',
      metadata: { avail_pk: '1001', customer_type_rate_pk: '2002', guest_count: '2' },
    })
    // Default: no such promo code — restored each test since a prior test may
    // override it (clearAllMocks keeps mockResolvedValue overrides, doesn't reset them).
    h.promoMaybeSingle.mockResolvedValue({ data: null })
  })

  it('validates + books + saves on the happy path', async () => {
    const res = await POST(mockReq(WEBSITE_BODY))

    expect(res.status).toBe(200)
    expect(h.fhValidate).toHaveBeenCalledTimes(1)
    expect(h.fhCreate).toHaveBeenCalledTimes(1)
    expect(h.insert).toHaveBeenCalledTimes(1)
    // No extras on this booking — nothing to auto-send to the supplier.
    expect(h.sendCateringOrderEmailForBooking).not.toHaveBeenCalled()
  })

  // ── Website payment gate (2026-07 security fix) ─────────────────────────────
  // The public /api/booking-flow/book takes no admin auth for `website` source, so
  // a website booking must prove a settled, matching payment before we ever touch
  // FareHarbor. Without this, anyone could POST a booking and consume boat capacity.

  it('SECURITY: rejects a website booking with NO payment intent (402) and never books', async () => {
    const res = await POST(mockReq({ ...WEBSITE_BODY, stripePaymentIntentId: undefined }))

    expect(res.status).toBe(402)
    expect(h.fhValidate).not.toHaveBeenCalled()
    expect(h.fhCreate).not.toHaveBeenCalled()
    expect(h.insert).not.toHaveBeenCalled()
  })

  it('SECURITY: rejects a website booking whose PaymentIntent has not succeeded (402)', async () => {
    h.piRetrieve.mockResolvedValue({
      status: 'requires_payment_method',
      metadata: { avail_pk: '1001', customer_type_rate_pk: '2002', guest_count: '2' },
    })

    const res = await POST(mockReq(WEBSITE_BODY))

    expect(res.status).toBe(402)
    expect(h.fhCreate).not.toHaveBeenCalled()
    expect(h.insert).not.toHaveBeenCalled()
  })

  it('SECURITY: rejects a website booking whose details do not match the paid PI (409)', async () => {
    // Paid for one slot, then tries to book a different (e.g. more expensive) one.
    h.piRetrieve.mockResolvedValue({
      status: 'succeeded',
      metadata: { avail_pk: '9999', customer_type_rate_pk: '2002', guest_count: '2' },
    })

    const res = await POST(mockReq(WEBSITE_BODY))

    expect(res.status).toBe(409)
    expect(h.fhCreate).not.toHaveBeenCalled()
    expect(h.insert).not.toHaveBeenCalled()
  })

  it('instantly auto-sends the catering email when departure is within 7 days', async () => {
    const res = await POST(mockReq({
      ...WEBSITE_BODY, // date: '2026-06-22' — in the past, always within window
      extrasSelected: [{ name: 'Cheese Platter', category: 'food', amount_cents: 2000, extra_id: 'x' }],
    }))

    expect(res.status).toBe(200)
    expect(h.sendCateringOrderEmailForBooking).toHaveBeenCalledTimes(1)
    expect(h.sendCateringOrderEmailForBooking).toHaveBeenCalledWith('booking-row-id')
  })

  it('does NOT instantly auto-send catering when departure is more than 7 days out', async () => {
    const res = await POST(mockReq({
      ...WEBSITE_BODY,
      date: '2099-01-01',
      extrasSelected: [{ name: 'Cheese Platter', category: 'food', amount_cents: 2000, extra_id: 'x' }],
    }))

    expect(res.status).toBe(200)
    // Held back for the daily cron to pick up once it crosses the 7-day mark.
    expect(h.sendCateringOrderEmailForBooking).not.toHaveBeenCalled()
  })

  it('returns deduplicated WITHOUT calling FareHarbor when a row already exists for the PI', async () => {
    // Idempotency SELECT finds an existing booking for this payment intent.
    h.maybeSingle.mockResolvedValue({ data: { id: 'b1', booking_uuid: 'fh-existing' } })

    const res = await POST(mockReq(WEBSITE_BODY))
    const json = await res.json()

    expect(json.data.deduplicated).toBe(true)
    expect(h.fhValidate).not.toHaveBeenCalled()
    expect(h.fhCreate).not.toHaveBeenCalled()
  })

  it('cancels our FareHarbor booking and stays silent on a 23505 save (handled race)', async () => {
    h.fhCreate.mockResolvedValue({ uuid: 'fh-dupe' })
    h.insert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } })

    const res = await POST(mockReq(WEBSITE_BODY))
    const json = await res.json()

    expect(json.data.deduplicated).toBe(true)
    expect(h.fhCancel).toHaveBeenCalledWith('fh-dupe')
    // A cleanly-handled race must NOT page anyone.
    expect(h.postSlackText).not.toHaveBeenCalled()
    expect(h.postSlackCritical).not.toHaveBeenCalled()
  })

  it('fires the CRITICAL repair alert (to Beer\'s DM, not just the channel) on a genuine (non-23505) save failure', async () => {
    h.fhCreate.mockResolvedValue({ uuid: 'fh-real' })
    h.insert.mockResolvedValue({ error: { code: '08006', message: 'connection failure' } })

    const res = await POST(mockReq(WEBSITE_BODY))

    expect(res.status).toBe(200) // customer still got their booking
    // Must go through postSlackCritical (DM + channel fallback), NOT the plain
    // channel-only postSlackText — this is the last-line safety net for a paid,
    // FareHarbor-booked cruise whose DB row failed to save.
    expect(h.postSlackCritical).toHaveBeenCalledWith(
      expect.stringContaining('CRITICAL: BOOKING DB SAVE FAILED'),
    )
    expect(h.postSlackCritical).toHaveBeenCalledWith(
      expect.stringContaining('recreate the FareHarbor booking'),
    )
  })

  it('books an admin stripe_recovery booking (surviving non-website caller)', async () => {
    const res = await POST(mockReq({
      ...WEBSITE_BODY,
      bookingSource: 'stripe_recovery',
      recoveryStripePaymentIntentId: 'pi_recovery_1',
    }))

    expect(res.status).toBe(200)
    expect(h.fhCreate).toHaveBeenCalledTimes(1)
  })
})

describe('POST /book — partner_invoice auth gate (Webikeamsterdam regression)', () => {
  // Regression: 023d68f gated ALL non-website bookingSources behind requireAdmin(),
  // which unintentionally broke the unauthenticated Webikeamsterdam QR checkout —
  // a real customer with a valid partner code, not an admin session. The code
  // itself is the authorization for that flow (resolvePartnerInvoiceContext
  // validates it and rejects anything bogus before a booking is created); admin
  // auth must stay required for a partner_invoice attempt with no code at all.
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SLACK_WEBHOOK_URL', 'https://hooks.slack.test/x')
    h.maybeSingle.mockResolvedValue({ data: null }) // listing lookup misses — fine, we only assert the auth gate
    h.insert.mockResolvedValue({ error: null, data: { id: 'booking-row-id' } })
  })

  it('does NOT require admin auth for partner_invoice with a promoCodeId (public QR checkout)', async () => {
    await POST(mockReq({ ...WEBSITE_BODY, bookingSource: 'partner_invoice', promoCodeId: 'promo-1' }))

    expect(h.requireAdmin).not.toHaveBeenCalled()
  })

  it('does NOT require admin auth for partner_invoice with a legacy partnerCode', async () => {
    await POST(mockReq({ ...WEBSITE_BODY, bookingSource: 'partner_invoice', partnerCode: 'WBKA-2X9F' }))

    expect(h.requireAdmin).not.toHaveBeenCalled()
  })

  it('still requires admin auth for partner_invoice with NO code at all', async () => {
    h.requireAdmin.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))

    const res = await POST(mockReq({ ...WEBSITE_BODY, bookingSource: 'partner_invoice' }))

    expect(h.requireAdmin).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(401)
    expect(h.fhCreate).not.toHaveBeenCalled()
  })

  it('still requires admin auth for other internal sources regardless of any code fields', async () => {
    h.requireAdmin.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))

    const res = await POST(mockReq({ ...WEBSITE_BODY, bookingSource: 'withlocals', promoCodeId: 'promo-1' }))

    expect(h.requireAdmin).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(401)
  })
})

describe('POST /book — complimentary auth gate (2026-07 anonymous full-discount fix)', () => {
  // Regression: the full-discount checkout (CheckoutFlow.tsx) previously sent an
  // ad-hoc bookingSource:'partner' — not even a value in BOOKING_SOURCES — which
  // required admin auth for EVERY caller, so a real customer redeeming a genuine
  // 100%-off code got a 401. Fixed to send 'complimentary' (the canonical value) with
  // a server-side re-validation of the promo: it must be a REAL, active,
  // discount_type:'full' code — the client's word is never trusted for authorization,
  // otherwise anyone could claim any promoCodeId for a free booking.
  const FULL_PROMO_ROW = {
    id: 'promo-full-1', code: 'FULL-COMP', label: 'Comp', discount_type: 'full',
    discount_value: null, fixed_discount_cents: null, max_uses: null, uses_count: 0,
    valid_from: null, valid_until: null, is_active: true, campaign_id: null, discount_scope: 'all',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SLACK_WEBHOOK_URL', 'https://hooks.slack.test/x')
    h.maybeSingle.mockResolvedValue({ data: null })
    h.insert.mockResolvedValue({ error: null, data: { id: 'booking-row-id' } })
    h.fhValidate.mockResolvedValue({ is_bookable: true })
    h.fhCreate.mockResolvedValue({ uuid: 'fh-new' })
    h.promoMaybeSingle.mockResolvedValue({ data: null })
  })

  it('does NOT require admin auth when the promo is real and discount_type:"full"', async () => {
    h.promoMaybeSingle.mockResolvedValue({ data: FULL_PROMO_ROW })

    const res = await POST(mockReq({ ...WEBSITE_BODY, bookingSource: 'complimentary', promoCodeId: 'promo-full-1', stripePaymentIntentId: undefined }))

    expect(h.requireAdmin).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
    expect(h.fhCreate).toHaveBeenCalledTimes(1)
  })

  it('still requires admin auth when NO promoCodeId is given (admin picks "complimentary" manually)', async () => {
    h.requireAdmin.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))

    const res = await POST(mockReq({ ...WEBSITE_BODY, bookingSource: 'complimentary', stripePaymentIntentId: undefined }))

    expect(h.requireAdmin).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(401)
    expect(h.fhCreate).not.toHaveBeenCalled()
  })

  it('SECURITY: still requires admin auth when the promoCodeId does not exist / is not active', async () => {
    h.requireAdmin.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    h.promoMaybeSingle.mockResolvedValue({ data: { ...FULL_PROMO_ROW, is_active: false } })

    const res = await POST(mockReq({ ...WEBSITE_BODY, bookingSource: 'complimentary', promoCodeId: 'promo-full-1', stripePaymentIntentId: undefined }))

    expect(h.requireAdmin).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(401)
    expect(h.fhCreate).not.toHaveBeenCalled()
  })

  it('SECURITY: a real but non-"full" promo (e.g. percentage) does NOT bypass admin auth, even if the client claims it is free', async () => {
    h.requireAdmin.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    h.promoMaybeSingle.mockResolvedValue({ data: { ...FULL_PROMO_ROW, discount_type: 'percentage', discount_value: 100 } })

    const res = await POST(mockReq({ ...WEBSITE_BODY, bookingSource: 'complimentary', promoCodeId: 'promo-full-1', stripePaymentIntentId: undefined }))

    expect(h.requireAdmin).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(401)
    expect(h.fhCreate).not.toHaveBeenCalled()
  })

  it('SECURITY: the full-promo exception is scoped to "complimentary" only, not other internal sources', async () => {
    h.requireAdmin.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    h.promoMaybeSingle.mockResolvedValue({ data: FULL_PROMO_ROW })

    const res = await POST(mockReq({ ...WEBSITE_BODY, bookingSource: 'withlocals', promoCodeId: 'promo-full-1', stripePaymentIntentId: undefined }))

    expect(h.requireAdmin).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(401)
  })
})

describe('POST /book — invoice_later (admin picks a partner directly)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SLACK_WEBHOOK_URL', 'https://hooks.slack.test/x')
    h.insert.mockResolvedValue({ error: null, data: { id: 'booking-row-id' } })
    h.fhValidate.mockResolvedValue({ is_bookable: true })
    h.fhCreate.mockResolvedValue({ uuid: 'fh-new' })
    h.requireAdmin.mockResolvedValue(null) // authenticated admin session
  })

  it('requires admin auth (no code-based bypass exists for this source)', async () => {
    await POST(mockReq({
      ...WEBSITE_BODY,
      bookingSource: 'invoice_later',
      partnerId: 'partner-1',
      invoiceAmountCents: 8500,
    }))

    expect(h.requireAdmin).toHaveBeenCalledTimes(1)
  })

  it('400s when partnerId is missing', async () => {
    const res = await POST(mockReq({ ...WEBSITE_BODY, bookingSource: 'invoice_later', invoiceAmountCents: 8500 }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/partnerId is required/)
    expect(h.insert).not.toHaveBeenCalled()
  })

  it('404s when the partner does not exist', async () => {
    h.maybeSingle.mockResolvedValue({ data: null })

    const res = await POST(mockReq({
      ...WEBSITE_BODY,
      bookingSource: 'invoice_later',
      partnerId: 'ghost-partner',
      invoiceAmountCents: 8500,
    }))
    const json = await res.json()

    expect(res.status).toBe(404)
    expect(json.error).toMatch(/Partner not found/)
    expect(h.insert).not.toHaveBeenCalled()
  })

  it('stores partner_id, derives commission from the admin-confirmed invoice amount, and sets payment_status', async () => {
    h.maybeSingle.mockResolvedValue({ data: { id: 'partner-1', name: 'Webikeamsterdam' } })

    const res = await POST(mockReq({
      ...WEBSITE_BODY,
      stripePaymentIntentId: undefined, // invoice_later has no Stripe payment — skip the idempotency lookup
      bookingSource: 'invoice_later',
      partnerId: 'partner-1',
      baseAmountCents: 10000,
      invoiceAmountCents: 8500, // admin edited down from a 100% suggestion, or a campaign gave 85%
    }))

    expect(res.status).toBe(200)
    expect(h.insert).toHaveBeenCalledTimes(1)
    expect(h.insert.mock.calls[0][0]).toMatchObject({
      partner_id: 'partner-1',
      commission_amount_cents: 1500, // 10000 - 8500
      payment_status: 'partner_invoice_pending',
      booking_source: 'invoice_later',
    })
  })

  it('defaults the invoice amount to the full base amount when not provided', async () => {
    h.maybeSingle.mockResolvedValue({ data: { id: 'partner-1', name: 'Webikeamsterdam' } })

    await POST(mockReq({
      ...WEBSITE_BODY,
      stripePaymentIntentId: undefined, // invoice_later has no Stripe payment — skip the idempotency lookup
      bookingSource: 'invoice_later',
      partnerId: 'partner-1',
      baseAmountCents: 10000,
    }))

    expect(h.insert.mock.calls[0][0]).toMatchObject({
      commission_amount_cents: 0, // full amount invoiced — nothing withheld
    })
  })
})
