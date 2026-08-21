import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

/**
 * Covers the pending-fh-sweep safety net — previously untested. Focus is the
 * 2026-07 fix: the escalation alert used to fire only inside a narrow 30-45min
 * age window, which assumed the cron runs every 15 minutes. It actually runs
 * once a day (Vercel Hobby plan), so the window was almost always missed. The
 * fix tracks "already escalated" via `fh_escalated_at` instead of a time window
 * — see the two-run test below, which is the actual regression guard.
 */

const state = vi.hoisted(() => ({
  candidates: [] as Record<string, unknown>[],
  claimedRow: null as Record<string, unknown> | null,
}))

const updateSpy = vi.hoisted(() => vi.fn())

const h = vi.hoisted(() => ({
  retrieve: vi.fn(),
  refundsList: vi.fn(),
  createBookingIdempotent: vi.fn(),
  postSlackText: vi.fn().mockResolvedValue(undefined),
  postSlackOps: vi.fn().mockResolvedValue(undefined),
  postSlackCritical: vi.fn().mockResolvedValue(undefined),
  notifyBookingsChanged: vi.fn().mockResolvedValue(undefined),
  sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  notifyCateringOrder: vi.fn().mockResolvedValue(undefined),
  sendCateringOrderEmailForBooking: vi.fn().mockResolvedValue({ ok: true, resent: false, recipient: 'x' }),
  resolvePaymentMethodLabel: vi.fn().mockResolvedValue('card'),
  requireCronSecret: vi.fn().mockReturnValue(null),
  getExtrasFromQuote: vi.fn().mockResolvedValue([]),
  buildFhBookingPlan: vi.fn().mockReturnValue({ availPk: 1, body: {}, date: '2026-08-01' }),
}))

vi.mock('@/lib/auth/require-cron-secret', () => ({ requireCronSecret: h.requireCronSecret }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== 'bookings') throw new Error(`unexpected table "${table}"`)
      return {
        select: () => ({
          or: () => ({
            not: () => ({
              order: () => ({
                limit: () => Promise.resolve({ data: state.candidates, error: null }),
              }),
            }),
          }),
        }),
        update: (patch: unknown) => {
          updateSpy(patch)
          return {
            eq: () => {
              // Supports both call shapes used by the route:
              //   .update().eq('id',x).eq('status',y).select().maybeSingle()  — the atomic claim
              //   .update().eq('id',x)                                        — bare await elsewhere
              const bare = Promise.resolve({ error: null }) as Promise<{ error: null }> & { eq: () => unknown }
              bare.eq = () => ({
                select: () => ({
                  maybeSingle: () => Promise.resolve({ data: state.claimedRow, error: null }),
                }),
              })
              return bare
            },
          }
        },
      }
    },
  }),
}))
vi.mock('@/lib/stripe/server', () => ({
  getStripe: () => ({
    paymentIntents: { retrieve: h.retrieve },
    refunds: { list: h.refundsList },
  }),
}))
vi.mock('@/lib/fareharbor/client', () => ({
  getFareHarborClient: () => ({ createBookingIdempotent: h.createBookingIdempotent }),
}))
vi.mock('@/lib/booking/finalize-booking', () => ({ buildFhBookingPlan: h.buildFhBookingPlan }))
vi.mock('@/lib/booking/pi-metadata', () => ({ getExtrasFromQuote: h.getExtrasFromQuote }))
vi.mock('@/lib/booking/send-confirmation-email', () => ({ sendConfirmationEmail: h.sendConfirmationEmail }))
vi.mock('@/lib/catering/notify', () => ({ notifyCateringOrder: h.notifyCateringOrder }))
vi.mock('@/lib/catering/auto-send-cutoff', () => ({ isWithinCateringAutoSendWindow: () => false }))
vi.mock('@/lib/catering/send-catering-email', () => ({ sendCateringOrderEmailForBooking: h.sendCateringOrderEmailForBooking }))
vi.mock('@/lib/slack/send-notification', () => ({ postSlackText: h.postSlackText, postSlackOps: h.postSlackOps, postSlackCritical: h.postSlackCritical }))
vi.mock('@/lib/realtime/notify-bookings-changed', () => ({ notifyBookingsChanged: h.notifyBookingsChanged }))
vi.mock('@/lib/stripe/payment-method-label', () => ({ resolvePaymentMethodLabel: h.resolvePaymentMethodLabel }))

import { GET } from './route'

function mockReq(): NextRequest {
  return {} as unknown as NextRequest
}

function minutesAgo(mins: number): string {
  return new Date(Date.now() - mins * 60 * 1000).toISOString()
}

function makeCandidate(over: Record<string, unknown> = {}) {
  return {
    id: 'booking-1',
    status: 'paid_pending_fh',
    stripe_payment_intent_id: 'pi_test_1',
    created_at: minutesAgo(5),
    ...over,
  }
}

function makeClaimedRow(over: Record<string, unknown> = {}) {
  return {
    id: 'booking-1',
    stripe_payment_intent_id: 'pi_test_1',
    created_at: minutesAgo(5),
    extras_selected: [],
    customer_email: 'a@example.com',
    customer_name: 'Test Guest',
    customer_phone: '+31600000000',
    listing_title: 'Canal Cruise',
    booking_date: '2026-08-01',
    start_time: '2026-08-01T15:00:00Z',
    end_time: '2026-08-01T16:30:00Z',
    guest_count: 2,
    category: 'private',
    fareharbor_customer_type_rate_pk: 1,
    base_amount_cents: 7000,
    discount_amount_cents: 0,
    stripe_amount: 7000,
    fh_escalated_at: null,
    ...over,
  }
}

describe('GET /api/cron/pending-fh-sweep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.candidates = []
    state.claimedRow = null
    h.retrieve.mockResolvedValue({ id: 'pi_test_1', metadata: {} })
    h.refundsList.mockResolvedValue({ data: [] })
    h.createBookingIdempotent.mockResolvedValue({ uuid: 'fh-test' })
  })

  it('completes a parked booking on the happy path', async () => {
    state.candidates = [makeCandidate()]
    state.claimedRow = makeClaimedRow()

    const res = await GET(mockReq())
    const json = await res.json()

    expect(json.completed).toBe(1)
    expect(json.failed).toBe(0)
    expect(h.createBookingIdempotent).toHaveBeenCalledTimes(1)
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed' }))
    expect(h.notifyBookingsChanged).toHaveBeenCalled()
  })

  it('cancels (never books) when the payment was already refunded', async () => {
    state.candidates = [makeCandidate()]
    state.claimedRow = makeClaimedRow()
    h.refundsList.mockResolvedValue({ data: [{ id: 're_1' }] })

    const res = await GET(mockReq())
    const json = await res.json()

    expect(json.cancelled).toBe(1)
    expect(h.createBookingIdempotent).not.toHaveBeenCalled()
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled', payment_status: 'refunded' }))
  })

  it('does NOT escalate a booking stuck for less than 30 minutes', async () => {
    state.candidates = [makeCandidate({ created_at: minutesAgo(10) })]
    state.claimedRow = makeClaimedRow({ created_at: minutesAgo(10) })
    h.createBookingIdempotent.mockRejectedValue(new Error('FH unavailable'))

    const res = await GET(mockReq())
    const json = await res.json()

    expect(json.failed).toBe(1)
    expect(h.postSlackCritical).not.toHaveBeenCalled()
    expect(updateSpy).not.toHaveBeenCalledWith(expect.objectContaining({ fh_escalated_at: expect.anything() }))
  })

  it(
    'SECURITY/REGRESSION: escalates exactly once for a stuck booking, ' +
    'then does NOT re-alert on a later run — cadence-independent (the 2026-07 fix)',
    async () => {
      // Run 1: booking has been stuck 40 minutes (past the 30-min mark), never escalated yet.
      state.candidates = [makeCandidate({ created_at: minutesAgo(40) })]
      state.claimedRow = makeClaimedRow({ created_at: minutesAgo(40), fh_escalated_at: null })
      h.createBookingIdempotent.mockRejectedValue(new Error('FH unavailable'))

      const res1 = await GET(mockReq())
      const json1 = await res1.json()

      expect(json1.failed).toBe(1)
      expect(h.postSlackCritical).toHaveBeenCalledTimes(1)
      expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ fh_escalated_at: expect.any(String) }))

      // Run 2: simulates the NEXT day's daily sweep — same booking, still stuck, but
      // fh_escalated_at is now set from run 1. Under the OLD 30-45min window logic this
      // would correctly not fire either (window long passed) — but for the WRONG reason,
      // and a booking stuck for, say, exactly 35 minutes on its one daily check would have
      // been the only way to ever see the alert. The new logic must not fire again,
      // regardless of age, once fh_escalated_at is set.
      h.postSlackCritical.mockClear()
      updateSpy.mockClear()
      state.candidates = [makeCandidate({ created_at: minutesAgo(40) })]
      state.claimedRow = makeClaimedRow({ created_at: minutesAgo(40), fh_escalated_at: minutesAgo(5) })
      h.createBookingIdempotent.mockRejectedValue(new Error('FH still unavailable'))

      const res2 = await GET(mockReq())
      const json2 = await res2.json()

      expect(json2.failed).toBe(1)
      expect(h.postSlackCritical).not.toHaveBeenCalled()
    },
  )

  it('returns cleanly with zero counts when there are no stuck bookings', async () => {
    state.candidates = []

    const res = await GET(mockReq())
    const json = await res.json()

    expect(json.ok).toBe(true)
    expect(json.swept).toBe(0)
  })
})
