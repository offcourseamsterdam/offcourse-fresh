import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

/**
 * Covers the extras-upsell cron — previously untested. The 2026-08 addition
 * under test: a successful send must also emit an 'extras_upsell_sent'
 * ops_events row (so a future "what did automated code do" admin panel has
 * something to show), and a failed/skipped send must NOT emit one — the
 * event log is for real actions taken, not attempts.
 */

const state = vi.hoisted(() => ({
  bookings: [] as Record<string, unknown>[],
  featuredExtras: [] as Record<string, unknown>[],
  totalExtras: 0,
}))

const h = vi.hoisted(() => ({
  requireCronSecret: vi.fn().mockReturnValue(null),
  send: vi.fn(),
  alertCronFailure: vi.fn().mockResolvedValue(undefined),
  emitOpsEvent: vi.fn().mockResolvedValue(undefined),
  updateSpy: vi.fn(),
}))

vi.mock('@/lib/auth/require-cron-secret', () => ({ requireCronSecret: h.requireCronSecret }))
vi.mock('@/lib/cron/alert', () => ({ alertCronFailure: h.alertCronFailure }))
vi.mock('@/lib/ops/events', () => ({ emitOpsEvent: h.emitOpsEvent }))
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: h.send }
  },
}))

/** A minimal thenable query-builder: every chain method returns itself, and
 *  awaiting it at any point resolves to whatever `result` was set to. */
function makeChain(result: unknown) {
  const obj: Record<string, unknown> = {}
  const methods = ['select', 'eq', 'in', 'is', 'not', 'order', 'limit', 'update']
  for (const m of methods) {
    obj[m] = vi.fn((...args: unknown[]) => {
      if (m === 'update') h.updateSpy(args[0])
      return obj
    })
  }
  obj.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject)
  return obj
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'bookings') {
        // Same object serves both the SELECT (eligible bookings) and each
        // per-booking UPDATE (marking extras_upsell_sent_at) — both resolve
        // fine since only the SELECT result is ever read by the route.
        return makeChain({ data: state.bookings, error: null })
      }
      if (table === 'extras') {
        // Distinguish the two 'extras' queries by their .select() args:
        // the head-count query passes { count: 'exact', head: true }.
        const obj: Record<string, unknown> = {}
        let isCount = false
        const methods = ['select', 'eq', 'in', 'not', 'order', 'limit']
        for (const m of methods) {
          obj[m] = vi.fn((...args: unknown[]) => {
            if (m === 'select' && args[1] && typeof args[1] === 'object' && 'count' in (args[1] as object)) {
              isCount = true
            }
            return obj
          })
        }
        obj.then = (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
          Promise.resolve(
            isCount
              ? { count: state.totalExtras, error: null }
              : { data: state.featuredExtras, error: null },
          ).then(resolve, reject)
        return obj
      }
      throw new Error(`unexpected table "${table}"`)
    },
  }),
}))

import { GET } from './route'

function mockReq(): NextRequest {
  return {} as unknown as NextRequest
}

function makeBooking(over: Record<string, unknown> = {}) {
  return {
    id: 'booking-1',
    customer_name: 'Test Guest',
    customer_email: 'guest@example.com',
    listing_title: 'Canal Cruise',
    listing_id: 'listing-1',
    booking_date: '2026-08-10',
    start_time: '2026-08-10T15:00:00Z',
    guest_count: 4,
    extras_selected: [],
    ...over,
  }
}

describe('GET /api/cron/extras-upsell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.bookings = []
    state.featuredExtras = []
    state.totalExtras = 0
    h.send.mockResolvedValue({ data: { id: 'email-1' }, error: null })
  })

  it('emits extras_upsell_sent with the booking id after a successful send', async () => {
    state.bookings = [makeBooking()]

    const res = await GET(mockReq())
    const json = await res.json()

    expect(json.sent).toBe(1)
    expect(h.emitOpsEvent).toHaveBeenCalledTimes(1)
    expect(h.emitOpsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'extras_upsell_sent',
        actorType: 'system',
        source: 'cron/extras-upsell',
        bookingId: 'booking-1',
        payload: expect.objectContaining({ recipient: 'guest@example.com', listingTitle: 'Canal Cruise' }),
      }),
    )
  })

  it('does NOT emit when the email send fails', async () => {
    state.bookings = [makeBooking()]
    h.send.mockRejectedValue(new Error('Resend down'))

    const res = await GET(mockReq())
    const json = await res.json()

    expect(json.sent).toBe(0)
    expect(json.failed).toEqual(['booking-1'])
    expect(h.emitOpsEvent).not.toHaveBeenCalled()
  })

  it('does NOT emit when there are no eligible bookings (nothing sent, nothing skipped)', async () => {
    state.bookings = []

    const res = await GET(mockReq())
    const json = await res.json()

    expect(json.sent).toBe(0)
    expect(h.emitOpsEvent).not.toHaveBeenCalled()
  })

  it('does NOT emit for a booking already covered by catering (filtered out before sending)', async () => {
    state.bookings = [
      makeBooking({ extras_selected: [{ name: 'Cheese board', amount_cents: 2500, category: 'food' }] }),
    ]

    const res = await GET(mockReq())
    const json = await res.json()

    expect(json.reason).toBe('No eligible bookings')
    expect(h.emitOpsEvent).not.toHaveBeenCalled()
    expect(h.send).not.toHaveBeenCalled()
  })
})
