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
  piRetrieve: vi.fn().mockResolvedValue({ metadata: {} }),
  resolveCustomerTypeName: vi.fn().mockResolvedValue(null),
  describeCustomerTypes: vi.fn().mockResolvedValue(null),
  sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  notifyCateringOrder: vi.fn().mockResolvedValue(undefined),
  sendCateringOrderEmailForBooking: vi.fn().mockResolvedValue({ ok: true, resent: false, recipient: 'x' }),
  notifyBookingFailure: vi.fn().mockResolvedValue(undefined),
  postSlackText: vi.fn().mockResolvedValue(undefined),
  requireAdmin: vi.fn().mockResolvedValue(null),
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
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: h.maybeSingle, single: h.maybeSingle }) }),
      // saveToSupabase now chains .insert(...).select('id').single() — h.insert
      // still receives the payload (existing call/payload assertions keep working)
      // and its configured resolved value ({ error, data? }) is what .single() returns.
      insert: (payload: unknown) => ({
        select: () => ({ single: () => h.insert(payload) }),
      }),
    }),
  }),
}))
vi.mock('@/lib/stripe/server', () => ({ getStripe: () => ({ paymentIntents: { retrieve: h.piRetrieve } }) }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/booking/send-confirmation-email', () => ({ sendConfirmationEmail: h.sendConfirmationEmail }))
vi.mock('@/lib/catering/notify', () => ({ notifyCateringOrder: h.notifyCateringOrder }))
vi.mock('@/lib/catering/send-catering-email', () => ({ sendCateringOrderEmailForBooking: h.sendCateringOrderEmailForBooking }))
vi.mock('@/lib/booking/notify-booking-failure', () => ({ notifyBookingFailure: h.notifyBookingFailure }))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackText: h.postSlackText }))

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
  })

  it('fires the CRITICAL repair alert on a genuine (non-23505) save failure', async () => {
    h.fhCreate.mockResolvedValue({ uuid: 'fh-real' })
    h.insert.mockResolvedValue({ error: { code: '08006', message: 'connection failure' } })

    const res = await POST(mockReq(WEBSITE_BODY))

    expect(res.status).toBe(200) // customer still got their booking
    expect(h.postSlackText).toHaveBeenCalledWith(
      expect.stringContaining('CRITICAL: BOOKING DB SAVE FAILED'),
    )
    expect(h.postSlackText).toHaveBeenCalledWith(
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
