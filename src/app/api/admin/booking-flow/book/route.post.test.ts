import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

/**
 * POST-level tests for the booking finalize handler, focused on the claim mutex
 * + alert rework added to fix the iDEAL double-booking:
 *   - a website booking claims the PI before calling FareHarbor;
 *   - a lost claim (duplicate / in_flight) returns deduplicated WITHOUT calling FareHarbor;
 *   - a 23505 on save cancels our FareHarbor booking and stays silent (handled race);
 *   - a genuine (non-23505) save failure fires the reworded CRITICAL alert;
 *   - internal/recovery bookings never attempt a claim.
 */

const h = vi.hoisted(() => ({
  claimPaymentIntent: vi.fn(),
  releaseClaim: vi.fn().mockResolvedValue(undefined),
  fhValidate: vi.fn().mockResolvedValue({ is_bookable: true }),
  fhCreate: vi.fn().mockResolvedValue({ uuid: 'fh-new' }),
  fhCancel: vi.fn().mockResolvedValue(undefined),
  maybeSingle: vi.fn().mockResolvedValue({ data: null }),
  insert: vi.fn().mockResolvedValue({ error: null }),
  piRetrieve: vi.fn().mockResolvedValue({ metadata: {} }),
  resolveCustomerTypeName: vi.fn().mockResolvedValue(null),
  sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  notifyCateringOrder: vi.fn().mockResolvedValue(undefined),
  notifyBookingFailure: vi.fn().mockResolvedValue(undefined),
  postSlackText: vi.fn().mockResolvedValue(undefined),
  requireAdmin: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/booking/booking-claims', () => ({
  claimPaymentIntent: h.claimPaymentIntent,
  releaseClaim: h.releaseClaim,
}))
vi.mock('@/lib/fareharbor/client', () => ({
  getFareHarborClient: () => ({
    validateBooking: h.fhValidate,
    createBooking: h.fhCreate,
    cancelBooking: h.fhCancel,
  }),
}))
vi.mock('@/lib/fareharbor/customer-type-name', () => ({ resolveCustomerTypeName: h.resolveCustomerTypeName }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: h.maybeSingle, single: h.maybeSingle }) }),
      insert: h.insert,
    }),
  }),
}))
vi.mock('@/lib/stripe/server', () => ({ getStripe: () => ({ paymentIntents: { retrieve: h.piRetrieve } }) }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/booking/send-confirmation-email', () => ({ sendConfirmationEmail: h.sendConfirmationEmail }))
vi.mock('@/lib/catering/notify', () => ({ notifyCateringOrder: h.notifyCateringOrder }))
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

describe('POST /book — claim mutex', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SLACK_WEBHOOK_URL', 'https://hooks.slack.test/x')
    h.claimPaymentIntent.mockResolvedValue('won')
    h.maybeSingle.mockResolvedValue({ data: null })
    h.insert.mockResolvedValue({ error: null })
    h.fhValidate.mockResolvedValue({ is_bookable: true })
    h.fhCreate.mockResolvedValue({ uuid: 'fh-new' })
  })

  it('claims the PI before FareHarbor and books on the happy path', async () => {
    const res = await POST(mockReq(WEBSITE_BODY))

    expect(res.status).toBe(200)
    expect(h.claimPaymentIntent).toHaveBeenCalledWith(expect.anything(), 'pi_book_1')
    expect(h.fhCreate).toHaveBeenCalledTimes(1)
    expect(h.releaseClaim).toHaveBeenCalledWith(expect.anything(), 'pi_book_1')
  })

  it('returns deduplicated WITHOUT calling FareHarbor when the claim is a duplicate', async () => {
    h.claimPaymentIntent.mockResolvedValue('duplicate')

    const res = await POST(mockReq(WEBSITE_BODY))
    const json = await res.json()

    expect(json.data.deduplicated).toBe(true)
    expect(h.fhValidate).not.toHaveBeenCalled()
    expect(h.fhCreate).not.toHaveBeenCalled()
  })

  it('returns deduplicated WITHOUT calling FareHarbor when the claim is in_flight', async () => {
    h.claimPaymentIntent.mockResolvedValue('in_flight')

    const res = await POST(mockReq(WEBSITE_BODY))
    const json = await res.json()

    expect(json.data.deduplicated).toBe(true)
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
    expect(h.releaseClaim).toHaveBeenCalledWith(expect.anything(), 'pi_book_1')
  })

  it('fires the reworded CRITICAL alert on a genuine (non-23505) save failure', async () => {
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

  it('does NOT attempt a claim for internal/stripe_recovery bookings (even with a PI)', async () => {
    const res = await POST(mockReq({
      ...WEBSITE_BODY,
      bookingSource: 'stripe_recovery',
      stripePaymentIntentId: 'pi_recovery_1',
    }))

    expect(res.status).toBe(200)
    expect(h.claimPaymentIntent).not.toHaveBeenCalled()
  })
})
