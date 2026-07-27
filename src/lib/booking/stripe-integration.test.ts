import { describe, it, expect, vi, beforeEach } from 'vitest'
import Stripe from 'stripe'
import type { NextRequest } from 'next/server'

/**
 * OPT-IN integration test — hits the REAL Stripe TEST-MODE API (real network calls,
 * real PaymentIntents on the "Off Course Canal Cruises" Stripe account's Sandbox) to
 * prove the 2026-07 money-path security fixes hold up against Stripe itself, not just
 * against mocks:
 *
 *   - 0.4: calculate-quote.ts derives the discount server-side from a promo code.
 *     A forged/stale quote total is rejected by the drift check rather than charged
 *     (this is the exact shape of the €0.50-booking exploit that was fixed).
 *   - 0.5: the /book payment gate only accepts a real, succeeded, metadata-matching
 *     PaymentIntent before creating a FareHarbor booking.
 *
 * FareHarbor and Supabase are fully mocked — no real booking or DB row is ever
 * created. Stripe's own test payment-method token (pm_card_visa) confirms
 * PaymentIntents without a browser.
 *
 * SKIPPED by default (never runs in `npm test` / CI). To run for real:
 *   STRIPE_MODE=test STRIPE_SECRET_KEY_TEST=sk_test_... npx vitest run src/lib/booking/stripe-integration.test.ts
 */

const RUN = process.env.STRIPE_MODE === 'test' && !!process.env.STRIPE_SECRET_KEY_TEST

const state = vi.hoisted(() => ({
  quoteRow: null as Record<string, unknown> | null,
  promoRow: null as Record<string, unknown> | null,
}))

const fh = vi.hoisted(() => ({
  getAvailabilityDetail: vi.fn(),
  validateBooking: vi.fn(),
  createBooking: vi.fn(),
  cancelBooking: vi.fn(),
}))

const notify = vi.hoisted(() => ({
  resolveCustomerTypeName: vi.fn().mockResolvedValue(null),
  describeCustomerTypes: vi.fn().mockResolvedValue(null),
  sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  notifyCateringOrder: vi.fn().mockResolvedValue(undefined),
  sendCateringOrderEmailForBooking: vi.fn().mockResolvedValue({ ok: true, resent: false, recipient: 'x' }),
  notifyBookingFailure: vi.fn().mockResolvedValue(undefined),
  postSlackText: vi.fn().mockResolvedValue(undefined),
  requireAdmin: vi.fn().mockResolvedValue(null),
}))

// Note: @/lib/stripe/server is intentionally NOT mocked — real Stripe test-mode calls.
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'pricing_quotes') {
        return {
          update: () => {
            // Supports both call shapes used by create-intent.ts:
            //   .update().eq().is().select().maybeSingle()  — the atomic claim
            //   .update().eq()                                — consumed_intent/release, bare await
            const eqResult = Promise.resolve({ error: null }) as Promise<{ error: null }> & { is: () => unknown }
            eqResult.is = () => ({
              select: () => ({
                maybeSingle: () => Promise.resolve({ data: state.quoteRow, error: null }),
              }),
            })
            return { eq: () => eqResult }
          },
        }
      }
      if (table === 'promo_codes') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.promoRow, error: null }) }) }) }
      }
      if (table === 'bookings') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ error: null, data: { id: 'booking-row-1' } }) }) }),
        }
      }
      throw new Error(`stripe-integration.test.ts: unexpected table "${table}"`)
    },
  }),
}))
vi.mock('@/lib/fareharbor/client', () => ({ getFareHarborClient: () => fh }))
vi.mock('@/lib/fareharbor/customer-type-name', () => ({
  resolveCustomerTypeName: notify.resolveCustomerTypeName,
  describeCustomerTypes: notify.describeCustomerTypes,
}))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: notify.requireAdmin }))
vi.mock('@/lib/booking/send-confirmation-email', () => ({ sendConfirmationEmail: notify.sendConfirmationEmail }))
vi.mock('@/lib/catering/notify', () => ({ notifyCateringOrder: notify.notifyCateringOrder }))
vi.mock('@/lib/catering/send-catering-email', () => ({ sendCateringOrderEmailForBooking: notify.sendCateringOrderEmailForBooking }))
vi.mock('@/lib/booking/notify-booking-failure', () => ({ notifyBookingFailure: notify.notifyBookingFailure }))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackText: notify.postSlackText }))

const CITY_TAX_PER_GUEST = 260 // src/lib/booking/constants.ts CITY_TAX_CENTS_PER_GUEST

function mockReq(body: object): NextRequest {
  return { json: async () => body, cookies: { get: () => undefined } } as unknown as NextRequest
}

describe.skipIf(!RUN)('Stripe test-mode integration — money path fixes (real network)', () => {
  const stripeTest = RUN ? new Stripe(process.env.STRIPE_SECRET_KEY_TEST!) : null!

  beforeEach(() => {
    vi.clearAllMocks()
    state.quoteRow = null
    state.promoRow = null
    fh.validateBooking.mockResolvedValue({ is_bookable: true })
    fh.createBooking.mockResolvedValue({ uuid: 'fh-integration-test' })
  })

  // ── 0.4: discount is derived server-side; forged totals never reach Stripe ──

  describe('createPaymentIntent — real Stripe PaymentIntent amount', () => {
    it(
      'charges the full price when there is no promo code',
      async () => {
        const guestCount = 2
        const baseRateCents = 10000
        const expectedTotal = baseRateCents + guestCount * CITY_TAX_PER_GUEST // 10520

        fh.getAvailabilityDetail.mockResolvedValue({
          customer_type_rates: [{ pk: 22201, customer_prototype: { total_including_tax: baseRateCents } }],
        })
        state.quoteRow = {
          id: 'quote-no-promo',
          listing_id: 'listing-1',
          avail_pk: 11101,
          customer_type_rate_pk: 22201,
          guest_count: guestCount,
          category: 'private',
          duration_minutes: 120,
          selected_extra_ids: [],
          extra_quantities: {},
          promo_code_id: null,
          total_cents: expectedTotal,
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          breakdown: {},
        }

        const { createPaymentIntent } = await import('@/lib/booking/create-intent')
        const result = await createPaymentIntent({
          quoteId: 'quote-no-promo',
          listingTitle: 'Canal Cruise',
          date: '2026-08-01',
          contact: { name: 'Test Guest', email: 't@example.com', phone: '+31600000000' },
        })

        expect(result.chargedCents).toBe(expectedTotal)
        expect(result.discountAmountCents).toBe(0)

        // Retrieve the REAL PaymentIntent Stripe created and check its actual amount.
        const piId = result.clientSecret.split('_secret_')[0]
        const realPi = await stripeTest.paymentIntents.retrieve(piId)
        expect(realPi.amount).toBe(expectedTotal)
      },
      15000,
    )

    it(
      'charges the discounted total when a valid promo code is re-derived server-side',
      async () => {
        const guestCount = 2
        const baseRateCents = 10000
        const fullTotal = baseRateCents + guestCount * CITY_TAX_PER_GUEST // 10520
        const expectedDiscount = Math.round(fullTotal * 0.2) // 2104
        const expectedTotal = fullTotal - expectedDiscount // 8416

        fh.getAvailabilityDetail.mockResolvedValue({
          customer_type_rates: [{ pk: 22202, customer_prototype: { total_including_tax: baseRateCents } }],
        })
        state.promoRow = {
          id: 'promo-20pct',
          code: 'TEST-20PCT',
          label: '20% off',
          discount_type: 'percentage',
          discount_value: 20,
          fixed_discount_cents: null,
          max_uses: null,
          uses_count: 0,
          valid_from: null,
          valid_until: null,
          is_active: true,
          campaign_id: null,
          discount_scope: 'all',
        }
        state.quoteRow = {
          id: 'quote-with-promo',
          listing_id: 'listing-1',
          avail_pk: 11102,
          customer_type_rate_pk: 22202,
          guest_count: guestCount,
          category: 'private',
          duration_minutes: 120,
          selected_extra_ids: [],
          extra_quantities: {},
          promo_code_id: 'promo-20pct',
          total_cents: expectedTotal,
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          breakdown: {},
        }

        const { createPaymentIntent } = await import('@/lib/booking/create-intent')
        const result = await createPaymentIntent({
          quoteId: 'quote-with-promo',
          listingTitle: 'Canal Cruise',
          date: '2026-08-01',
          contact: { name: 'Test Guest', email: 't@example.com', phone: '+31600000000' },
        })

        expect(result.discountAmountCents).toBe(expectedDiscount)
        expect(result.chargedCents).toBe(expectedTotal)

        const piId = result.clientSecret.split('_secret_')[0]
        const realPi = await stripeTest.paymentIntents.retrieve(piId)
        expect(realPi.amount).toBe(expectedTotal)
      },
      15000,
    )

    it(
      'SECURITY: a poisoned quote (forged €0.50 total, no real promo) is rejected — never reaches Stripe',
      async () => {
        // Reproduces the exact shape of the pre-fix exploit: a /quote call that once
        // forged discountAmountCents to drive the total to the Stripe minimum. Post-fix,
        // even if such a row existed, create-intent recomputes the total from the promo
        // code (none here) and the drift check rejects the mismatch before any PI is made.
        const guestCount = 2
        const baseRateCents = 10000

        fh.getAvailabilityDetail.mockResolvedValue({
          customer_type_rates: [{ pk: 22203, customer_prototype: { total_including_tax: baseRateCents } }],
        })
        state.quoteRow = {
          id: 'quote-poisoned',
          listing_id: 'listing-1',
          avail_pk: 11103,
          customer_type_rate_pk: 22203,
          guest_count: guestCount,
          category: 'private',
          duration_minutes: 120,
          selected_extra_ids: [],
          extra_quantities: {},
          promo_code_id: null,
          total_cents: 50, // the forged €0.50 total
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
          breakdown: {},
        }

        const { createPaymentIntent } = await import('@/lib/booking/create-intent')
        await expect(
          createPaymentIntent({
            quoteId: 'quote-poisoned',
            listingTitle: 'Canal Cruise',
            date: '2026-08-01',
            contact: { name: 'Attacker', email: 'a@example.com', phone: '+31600000000' },
          }),
        ).rejects.toThrow(/price changed/i)
        // No assertion against Stripe needed: the code path throws before
        // paymentIntents.create is ever reached (verified by the throw itself).
      },
      15000,
    )
  })

  // ── 0.5: /book only accepts a real, succeeded, matching PaymentIntent ────────

  describe('POST /book — real PaymentIntent payment gate', () => {
    function bookBody(pi: { id: string }, over: Record<string, unknown> = {}) {
      return {
        availPk: 3001,
        customerTypeRatePk: 4002,
        guestCount: 2,
        category: 'shared',
        contact: { name: 'Test Guest', email: 't@example.com', phone: '+31600000000' },
        listingId: 'listing-1',
        listingTitle: 'Canal Cruise',
        date: '2026-08-01',
        startAt: '2026-08-01T15:00:00Z',
        endAt: '2026-08-01T16:30:00Z',
        amountCents: 7000,
        stripePaymentIntentId: pi.id,
        baseAmountCents: 7000,
        extrasAmountCents: 0,
        totalVatAmountCents: 578,
        bookingSource: 'website',
        ...over,
      }
    }

    it(
      'books when the PaymentIntent is REAL, succeeded, and matches the booking',
      async () => {
        const pi = await stripeTest.paymentIntents.create({
          amount: 7000,
          currency: 'eur',
          payment_method_types: ['card'],
          metadata: { avail_pk: '3001', customer_type_rate_pk: '4002', guest_count: '2' },
        })
        const confirmed = await stripeTest.paymentIntents.confirm(pi.id, { payment_method: 'pm_card_visa' })
        expect(confirmed.status).toBe('succeeded') // sanity check on Stripe's own state

        const { POST } = await import('@/app/api/admin/booking-flow/book/route')
        const res = await POST(mockReq(bookBody(pi)))

        expect(res.status).toBe(200)
        expect(fh.createBooking).toHaveBeenCalledTimes(1)
      },
      20000,
    )

    it(
      'SECURITY: rejects a REAL but unconfirmed PaymentIntent (402), never books',
      async () => {
        const pi = await stripeTest.paymentIntents.create({
          amount: 5000,
          currency: 'eur',
          payment_method_types: ['card'],
          metadata: { avail_pk: '3002', customer_type_rate_pk: '4003', guest_count: '1' },
        })
        // Not confirmed — Stripe's real status is 'requires_payment_method'.

        const { POST } = await import('@/app/api/admin/booking-flow/book/route')
        const res = await POST(mockReq(bookBody(pi, {
          availPk: 3002, customerTypeRatePk: 4003, guestCount: 1, amountCents: 5000, baseAmountCents: 5000,
        })))

        expect(res.status).toBe(402)
        expect(fh.createBooking).not.toHaveBeenCalled()
      },
      20000,
    )

    it(
      'SECURITY: rejects a REAL succeeded PaymentIntent whose paid-for slot does not match the booking (409)',
      async () => {
        const pi = await stripeTest.paymentIntents.create({
          amount: 7000,
          currency: 'eur',
          payment_method_types: ['card'],
          metadata: { avail_pk: '3003', customer_type_rate_pk: '4004', guest_count: '2' },
        })
        await stripeTest.paymentIntents.confirm(pi.id, { payment_method: 'pm_card_visa' })

        // Paid for slot 3003, but the request asks to book a different (e.g. pricier) slot.
        const { POST } = await import('@/app/api/admin/booking-flow/book/route')
        const res = await POST(mockReq(bookBody(pi, { availPk: 9999 })))

        expect(res.status).toBe(409)
        expect(fh.createBooking).not.toHaveBeenCalled()
      },
      20000,
    )
  })
})
