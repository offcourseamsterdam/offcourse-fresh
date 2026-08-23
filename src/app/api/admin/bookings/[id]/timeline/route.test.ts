import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ requireAdmin: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))

import { GET } from './route'
import { createAdminClient } from '@/lib/supabase/admin'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

const BOOKING = {
  id: 'b1',
  status: 'confirmed',
  created_at: '2026-08-01T10:00:00Z',
  extras_selected: [] as Array<{ name: string; category: string; amount_cents: number; quantity: number }>,
  catering_email_sent_at: null as string | null,
  catering_confirmed_at: null as string | null,
  fareharbor_availability_pk: 42,
}

/**
 * `booking` seeds the bookings lookup. `ownShift` seeds the booking_id-owned
 * shift lookup (maybeSingle). `sharedShift` seeds the fallback
 * fareharbor_availability_pk lookup used when the own shift has no captain.
 * `event` seeds the ops_events lookup for the shift_assigned timestamp.
 */
function makeSupabase({
  booking,
  ownShift = null,
  sharedShift = null,
  event = null,
}: {
  booking: typeof BOOKING | null
  ownShift?: { id: string; staff_id: string | null } | null
  sharedShift?: { id: string; staff_id: string | null } | null
  event?: { occurred_at: string } | null
}) {
  const from = vi.fn((table: string) => {
    if (table === 'bookings') {
      return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: booking, error: booking ? null : { message: 'not found' } }) }) }) }
    }
    if (table === 'shifts') {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: ownShift }) }),
        }),
      }
    }
    throw new Error(`unexpected table: ${table}`)
  })
  return { from }
}

/**
 * The route issues two different `shifts` queries (own-booking, then the
 * shared-cruise fallback) — this variant tells them apart by call order so
 * tests can stub each independently.
 */
function makeSupabaseWithFallback({
  booking,
  ownShift,
  sharedShift,
  event,
}: {
  booking: typeof BOOKING | null
  ownShift: { id: string; staff_id: string | null } | null
  sharedShift: { id: string; staff_id: string | null } | null
  event: { occurred_at: string } | null
}) {
  let shiftCallCount = 0
  const from = vi.fn((table: string) => {
    if (table === 'bookings') {
      return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: booking, error: null }) }) }) }
    }
    if (table === 'shifts') {
      shiftCallCount++
      if (shiftCallCount === 1) {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: ownShift }) }) }) }
      }
      return {
        select: () => ({
          eq: () => ({
            not: () => ({
              limit: () => ({ maybeSingle: () => Promise.resolve({ data: sharedShift }) }),
            }),
          }),
        }),
      }
    }
    if (table === 'ops_events') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: event }) }) }),
            }),
          }),
        }),
      }
    }
    throw new Error(`unexpected table: ${table}`)
  })
  return { from }
}

function makeReq(id: string) {
  return [{} as never, { params: Promise.resolve({ id }) }] as const
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/admin/bookings/[id]/timeline', () => {
  it('returns 404 for an unknown booking id', async () => {
    vi.mocked(createAdminClient).mockReturnValue(makeSupabase({ booking: null }) as never)

    const res = await GET(...makeReq('missing'))
    expect(res.status).toBe(404)
  })

  it('marks captain_assigned done via the booking-owned shift', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeSupabaseWithFallback({
        booking: BOOKING,
        ownShift: { id: 'shift-1', staff_id: 'staff-1' },
        sharedShift: null,
        event: { occurred_at: '2026-08-02T08:00:00Z' },
      }) as never,
    )

    const res = await GET(...makeReq('b1'))
    const body = await res.json()

    const byKey = Object.fromEntries(body.data.steps.map((s: { key: string }) => [s.key, s]))
    expect(byKey.captain_assigned.done).toBe(true)
    expect(byKey.captain_assigned.occurredAt).toBe('2026-08-02T08:00:00Z')
  })

  it('reports catering ordered but not yet confirmed', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeSupabaseWithFallback({
        booking: { ...BOOKING, extras_selected: [{ name: 'Cheese board', category: 'food', amount_cents: 1000, quantity: 1 }], catering_email_sent_at: '2026-08-01T12:00:00Z' },
        ownShift: null,
        sharedShift: null,
        event: null,
      }) as never,
    )

    const res = await GET(...makeReq('b1'))
    const body = await res.json()

    const byKey = Object.fromEntries(body.data.steps.map((s: { key: string }) => [s.key, s]))
    expect(byKey.catering_ordered.done).toBe(true)
    expect(byKey.catering_confirmed.done).toBe(false)
  })

  it('falls back to a sibling shift on the same FareHarbor availability slot for shared cruises', async () => {
    vi.mocked(createAdminClient).mockReturnValue(
      makeSupabaseWithFallback({
        booking: BOOKING,
        ownShift: { id: 'shift-own', staff_id: null },
        sharedShift: { id: 'shift-shared', staff_id: 'staff-2' },
        event: { occurred_at: '2026-08-03T09:00:00Z' },
      }) as never,
    )

    const res = await GET(...makeReq('b1'))
    const body = await res.json()

    const byKey = Object.fromEntries(body.data.steps.map((s: { key: string }) => [s.key, s]))
    expect(byKey.captain_assigned.done).toBe(true)
    expect(byKey.captain_assigned.occurredAt).toBe('2026-08-03T09:00:00Z')
  })
})
