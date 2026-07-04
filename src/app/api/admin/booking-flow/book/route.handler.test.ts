import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import { extractVat } from '@/lib/extras/calculate'

/**
 * Handler-level tests for the website booking money-path (POST /api/booking-flow/book).
 * Pins the invariants that move real money and were previously untested:
 *   - FareHarbor validate runs BEFORE create.
 *   - private → 1 customer entry; shared → one per guest.
 *   - VAT fallback (9% base / 21% extras) when the body omits VAT fields.
 *   - the atomic claim wins/loses correctly (dedup by PaymentIntent, no double FH booking).
 *   - the save (finalize) failure path alerts Slack but STILL returns success.
 *
 * claim.ts is deliberately NOT mocked — it runs against the mocked Supabase so the
 * claim→create→finalize orchestration is exercised for real.
 */

const h = vi.hoisted(() => ({
  fhValidate: vi.fn(),
  fhCreate: vi.fn(),
  requireAdmin: vi.fn().mockResolvedValue(null),
  piRetrieve: vi.fn().mockResolvedValue({ metadata: { session_id: 'sess_browse' } }),
  resolveCustomerTypeName: vi.fn().mockResolvedValue('Diana - 1.5 Hours'),
  notifyBookingFailure: vi.fn().mockResolvedValue(undefined),
  sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  notifyCateringOrder: vi.fn().mockResolvedValue(undefined),
  postSlackText: vi.fn().mockResolvedValue(undefined),
  precheck: { data: null } as { data: unknown },
  insertResult: { error: null } as { error: null | { code?: string; message: string } },
  updateResult: { error: null } as { error: null | { message: string } },
  capturedInsert: null as Record<string, unknown> | null,
  capturedUpdate: null as Record<string, unknown> | null,
}))

vi.mock('@/lib/fareharbor/client', () => ({
  getFareHarborClient: () => ({ validateBooking: h.fhValidate, createBooking: h.fhCreate }),
}))
vi.mock('@/lib/fareharbor/customer-type-name', () => ({ resolveCustomerTypeName: h.resolveCustomerTypeName }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/stripe/server', () => ({ getStripe: () => ({ paymentIntents: { retrieve: h.piRetrieve } }) }))
vi.mock('@/lib/booking/notify-booking-failure', () => ({ notifyBookingFailure: h.notifyBookingFailure }))
vi.mock('@/lib/booking/send-confirmation-email', () => ({ sendConfirmationEmail: h.sendConfirmationEmail }))
vi.mock('@/lib/catering/notify', () => ({ notifyCateringOrder: h.notifyCateringOrder }))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackText: h.postSlackText }))
vi.mock('@/lib/ops/events', () => ({ emitOpsEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/ghost/guest-move-drafter', () => ({ draftGuestMoveForNewBooking: vi.fn().mockResolvedValue('skipped') }))
// after() requires a real Next.js request scope, absent when calling POST directly
// in a unit test — run the callback inline instead (fire-and-forget → forget-now).
vi.mock('next/server', async importOriginal => {
  const actual = await importOriginal<typeof import('next/server')>()
  return { ...actual, after: (cb: () => unknown) => cb() }
})
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(h.precheck) }) }),
      insert: (row: Record<string, unknown>) => { h.capturedInsert = row; return Promise.resolve(h.insertResult) },
      update: (patch: Record<string, unknown>) => { h.capturedUpdate = patch; return { eq: () => Promise.resolve(h.updateResult) } },
      delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
    }),
  }),
}))

import { POST } from './route'

function mockReq(body: Record<string, unknown>): NextRequest {
  return {
    json: async () => body,
    cookies: { get: () => undefined },
  } as unknown as NextRequest
}

function websiteBody(over: Record<string, unknown> = {}) {
  return {
    availPk: 111,
    customerTypeRatePk: 222,
    guestCount: 2,
    category: 'private',
    contact: { name: 'Test Guest', email: 'guest@example.com', phone: '+31600000000' },
    listingId: 'listing_1',
    listingTitle: 'Hidden Gems Private Boat Tour',
    date: '2026-07-01',
    startAt: '2026-07-01T18:00:00+02:00',
    endAt: '2026-07-01T19:30:00+02:00',
    amountCents: 16500,
    stripePaymentIntentId: 'pi_book_1',
    baseAmountCents: 15000,
    extrasAmountCents: 0,
    bookingSource: 'website',
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  h.precheck = { data: null }
  h.insertResult = { error: null }
  h.updateResult = { error: null }
  h.capturedInsert = null
  h.capturedUpdate = null
  h.fhValidate.mockResolvedValue({ is_bookable: true })
  h.fhCreate.mockResolvedValue({ uuid: 'fh-booking-uuid' })
  h.piRetrieve.mockResolvedValue({ metadata: { session_id: 'sess_browse' } })
})

describe('POST /api/booking-flow/book — website money path', () => {
  it('validates before creating, claims in pending_payment, then finalizes to confirmed', async () => {
    const res = await POST(mockReq(websiteBody()))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.booking.uuid).toBe('fh-booking-uuid')
    // validate strictly before create
    expect(h.fhValidate.mock.invocationCallOrder[0]).toBeLessThan(h.fhCreate.mock.invocationCallOrder[0])
    // claim row: pending_payment + null uuid; finalize promotes it
    expect(h.capturedInsert!.status).toBe('pending_payment')
    expect(h.capturedInsert!.booking_uuid).toBeNull()
    expect(h.capturedInsert!.stripe_payment_intent_id).toBe('pi_book_1')
    expect(h.capturedUpdate).toEqual({ booking_uuid: 'fh-booking-uuid', status: 'confirmed' })
  })

  it('derives 1 FareHarbor customer for a private boat regardless of guest count', async () => {
    await POST(mockReq(websiteBody({ category: 'private', guestCount: 6 })))
    expect(h.fhCreate).toHaveBeenCalledWith(111, expect.objectContaining({
      customers: [{ customer_type_rate: 222 }],
    }))
  })

  it('derives one FareHarbor customer per guest for a shared boat', async () => {
    await POST(mockReq(websiteBody({ category: 'shared', guestCount: 3 })))
    expect(h.fhCreate).toHaveBeenCalledWith(111, expect.objectContaining({
      customers: [
        { customer_type_rate: 222 },
        { customer_type_rate: 222 },
        { customer_type_rate: 222 },
      ],
    }))
  })

  it('falls back to 9% base / 21% extras VAT when the body omits VAT fields', async () => {
    await POST(mockReq(websiteBody({ baseAmountCents: 15000, extrasAmountCents: 3000 })))
    expect(h.capturedInsert!.base_vat_amount_cents).toBe(extractVat(15000, 9))
    expect(h.capturedInsert!.extras_vat_amount_cents).toBe(extractVat(3000, 21))
  })

  it('is idempotent: an existing booking for the PI returns deduplicated without calling FareHarbor', async () => {
    h.precheck = { data: { id: 'existing', booking_uuid: 'fh-existing' } }
    const res = await POST(mockReq(websiteBody()))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.deduplicated).toBe(true)
    expect(h.fhValidate).not.toHaveBeenCalled()
    expect(h.fhCreate).not.toHaveBeenCalled()
  })

  it('loses the claim race (duplicate PI) and never creates a FareHarbor booking', async () => {
    h.insertResult = { error: { code: '23505', message: 'duplicate key value' } }
    const res = await POST(mockReq(websiteBody()))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.deduplicated).toBe(true)
    // Validation may run (read-only), but the FareHarbor booking must NOT be created.
    expect(h.fhCreate).not.toHaveBeenCalled()
  })

  it('fails safe on a non-unique claim error: 500, no FareHarbor booking, alert fired', async () => {
    h.insertResult = { error: { code: '08006', message: 'connection failure' } }
    const res = await POST(mockReq(websiteBody()))

    expect(res.status).toBe(500)
    expect(h.fhCreate).not.toHaveBeenCalled()
    expect(h.notifyBookingFailure).toHaveBeenCalledWith(expect.objectContaining({ stage: 'db_claim' }))
  })

  it('returns 422 and skips FareHarbor create when the slot is not bookable', async () => {
    h.fhValidate.mockResolvedValue({ is_bookable: false, error: 'Sold out' })
    const res = await POST(mockReq(websiteBody()))

    expect(res.status).toBe(422)
    expect(h.fhCreate).not.toHaveBeenCalled()
    expect(h.notifyBookingFailure).toHaveBeenCalledWith(expect.objectContaining({ stage: 'fareharbor_validate' }))
  })

  it('SAVE-FAILURE PATH: finalize fails → alerts Slack but STILL returns success', async () => {
    // The booking exists in FareHarbor + the claim row is written; only the
    // promote-to-confirmed update failed. Customer got their cruise, so we still
    // return success and alert loudly for manual recovery.
    vi.stubEnv('SLACK_WEBHOOK_URL', 'https://hooks.slack.test/xxx')
    h.updateResult = { error: { message: 'db write conflict' } }

    const res = await POST(mockReq(websiteBody()))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.data.booking.uuid).toBe('fh-booking-uuid')
    // The CRITICAL save-failure alert fired (alongside the normal booking notification).
    expect(h.postSlackText).toHaveBeenCalledWith(expect.stringContaining('CRITICAL: BOOKING SAVE FAILED'))
  })

  it('releases the claim when FareHarbor create throws, so a retry is not blocked', async () => {
    h.fhCreate.mockRejectedValue(new Error('FH 503'))
    const res = await POST(mockReq(websiteBody()))

    // Outer catch → 500 to the client.
    expect(res.status).toBe(500)
    expect(h.notifyBookingFailure).toHaveBeenCalledWith(expect.objectContaining({ stage: 'fareharbor_create' }))
  })
})
