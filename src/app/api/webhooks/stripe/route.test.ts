import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

/**
 * Tests the Stripe webhook's most consequential invariants WITHOUT touching the
 * handler (it's the money path):
 *   1. The Google Ads conversion is reported BEFORE the idempotency early-return,
 *      so card payments already booked by /book still fire a conversion.
 *   2. An already-processed PaymentIntent does NOT create a second FareHarbor
 *      booking (idempotency).
 *   3. A bad signature is rejected with 400 and does no work.
 */

const h = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  reportBookingConversion: vi.fn().mockResolvedValue(undefined),
  reportRefundAdjustment: vi.fn().mockResolvedValue(undefined),
  fhCreateBooking: vi.fn(),
  fhValidateBooking: vi.fn(),
  maybeSingle: vi.fn(),
  sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  notifyCateringOrder: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({ webhooks: { constructEvent: h.constructEvent } }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: h.maybeSingle }) }),
    }),
  }),
}))
vi.mock('@/lib/google-ads/report-conversion', () => ({ reportBookingConversion: h.reportBookingConversion }))
vi.mock('@/lib/google-ads/report-refund', () => ({ reportRefundAdjustment: h.reportRefundAdjustment }))
vi.mock('@/lib/fareharbor/client', () => ({
  getFareHarborClient: () => ({ createBooking: h.fhCreateBooking, validateBooking: h.fhValidateBooking }),
}))
vi.mock('@/lib/booking/send-confirmation-email', () => ({ sendConfirmationEmail: h.sendConfirmationEmail }))
vi.mock('@/lib/catering/notify', () => ({ notifyCateringOrder: h.notifyCateringOrder }))

import { POST } from './route'

function mockReq(): NextRequest {
  return {
    text: async () => 'raw-body',
    headers: { get: () => 'sig-header' },
  } as unknown as NextRequest
}

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
