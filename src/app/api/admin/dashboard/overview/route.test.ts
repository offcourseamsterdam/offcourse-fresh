import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  requireAdmin: vi.fn().mockResolvedValue(null),
  getNextAvailabilityRequestDate: vi.fn().mockReturnValue({
    targetMonth: '2026-10',
    targetMonthStart: '2026-10-01',
    triggerDate: '2026-08-20',
    daysUntil: 12,
  }),
  getNextScheduleDigestAt: vi.fn().mockReturnValue('2026-08-08T16:00:00.000Z'),
}))

vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/scheduling/availability-request', () => ({ getNextAvailabilityRequestDate: h.getNextAvailabilityRequestDate }))
vi.mock('@/lib/scheduling/schedule-digest', () => ({ getNextScheduleDigestAt: h.getNextScheduleDigestAt }))

/** A chainable builder that resolves to `result` on await, regardless of
 * how many filter methods were called first. */
function makeThenable(result: unknown) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    neq: () => builder,
    in: () => builder,
    gte: () => builder,
    lte: () => builder,
    order: () => builder,
    then: (resolve: (v: unknown) => void) => resolve(result),
  }
  return builder
}

const state = vi.hoisted(() => ({
  bookingsCallResults: [] as unknown[],
  shifts: { data: [] as unknown[], error: null },
  stock: { data: [] as unknown[], error: null },
  openChats: { count: 0, error: null },
  awaitingReview: { count: 0, error: null },
}))

let bookingsCallIndex = 0

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'bookings') return makeThenable(state.bookingsCallResults[bookingsCallIndex++])
      if (table === 'shifts') return makeThenable(state.shifts)
      if (table === 'stock_items') return makeThenable(state.stock)
      if (table === 'conversations') return makeThenable(state.openChats)
      if (table === 'agent_proposals') return makeThenable(state.awaitingReview)
      throw new Error(`unexpected table: ${table}`)
    },
  }),
}))

import { GET } from './route'
import { GHOST_AGENTS } from '@/lib/ghost/agents'
import { amsterdamToday } from '@/lib/utils'

const TODAY = amsterdamToday()
const TOMORROW = amsterdamToday(1)
const IN_TWO_DAYS = amsterdamToday(2)

beforeEach(() => {
  vi.clearAllMocks()
  h.requireAdmin.mockResolvedValue(null)
  bookingsCallIndex = 0
  // Default: today=0, week=0, reconciliation=0 — override per test.
  state.bookingsCallResults = [
    { data: [], count: 0, error: null },
    { data: [], count: 0, error: null },
    { count: 0, error: null },
  ]
  state.shifts = { data: [], error: null }
  state.stock = { data: [], error: null }
  state.openChats = { count: 0, error: null }
  state.awaitingReview = { count: 0, error: null }
})

describe('GET /api/admin/dashboard/overview', () => {
  it('rejects unauthenticated requests', async () => {
    const denied = new Response('denied', { status: 401 })
    h.requireAdmin.mockResolvedValue(denied)

    const res = await GET()

    expect(res).toBe(denied)
  })

  it('counts cruises today/this week and sums revenue from active bookings only', async () => {
    state.bookingsCallResults[0] = { data: [{ id: 'b1' }, { id: 'b2' }], count: 2, error: null }
    state.bookingsCallResults[1] = { data: [{ stripe_amount: 10000 }, { stripe_amount: 5000 }], count: 5, error: null }

    const res = await GET()
    const body = await res.json()

    expect(body.data.business.cruisesToday).toBe(2)
    expect(body.data.business.cruisesThisWeek).toBe(5)
    expect(body.data.business.revenueThisWeekCents).toBe(15000)
  })

  it('surfaces needsReconciliationCount from the bookings table', async () => {
    state.bookingsCallResults[2] = { count: 133, error: null }

    const res = await GET()
    const body = await res.json()

    expect(body.data.business.needsReconciliationCount).toBe(133)
  })

  it('flags stock items at or below their reorder threshold, excluding ones above it', async () => {
    state.stock = {
      data: [
        { id: 's1', name: 'Cups', current_count: 2, reorder_threshold: 10 },
        { id: 's2', name: 'Napkins', current_count: 50, reorder_threshold: 10 },
      ],
      error: null,
    }

    const res = await GET()
    const body = await res.json()

    expect(body.data.business.lowStock).toEqual([{ name: 'Cups', currentCount: 2, reorderThreshold: 10 }])
  })

  it('lists today\'s shifts with captain and boat names, and groups the week by captain', async () => {
    state.shifts = {
      data: [
        { id: 'sh1', date: TODAY, start_at: `${TODAY}T13:00:00Z`, end_at: `${TODAY}T15:00:00Z`, status: 'assigned', staff: { name: 'Beer Zoomers' }, boats: { name: 'Diana' } },
        { id: 'sh2', date: TOMORROW, start_at: `${TOMORROW}T13:00:00Z`, end_at: `${TOMORROW}T15:00:00Z`, status: 'assigned', staff: { name: 'Beer Zoomers' }, boats: { name: 'Curaçao' } },
        { id: 'sh3', date: IN_TWO_DAYS, start_at: `${IN_TWO_DAYS}T13:00:00Z`, end_at: `${IN_TWO_DAYS}T15:00:00Z`, status: 'open', staff: null, boats: { name: 'Diana' } },
      ],
      error: null,
    }

    const res = await GET()
    const body = await res.json()

    expect(body.data.captains.today).toEqual([
      { id: 'sh1', startAt: `${TODAY}T13:00:00Z`, endAt: `${TODAY}T15:00:00Z`, staffName: 'Beer Zoomers', boatName: 'Diana', status: 'assigned' },
    ])
    expect(body.data.captains.thisWeekByCaptain).toEqual([{ staffName: 'Beer Zoomers', shiftCount: 2 }])
    expect(body.data.captains.openShiftsThisWeek).toBe(1)
  })

  it('surfaces AI activity counts and the two next-cadence times', async () => {
    state.openChats = { count: 7, error: null }
    state.awaitingReview = { count: 3, error: null }

    const res = await GET()
    const body = await res.json()

    expect(body.data.aiActivity).toEqual({
      openChatsCount: 7,
      awaitingReviewCount: 3,
      nextScheduleDigestAt: '2026-08-08T16:00:00.000Z',
      nextAvailabilityRequest: {
        targetMonth: '2026-10',
        targetMonthStart: '2026-10-01',
        triggerDate: '2026-08-20',
        daysUntil: 12,
      },
    })
  })

  it('reports every real Ghost agent\'s actual autonomy level, not a hardcoded guess', async () => {
    const res = await GET()
    const body = await res.json()

    expect(body.data.agentProgress).toHaveLength(GHOST_AGENTS.length)
    const scheduling = body.data.agentProgress.find((a: { key: string }) => a.key === 'scheduling')
    expect(scheduling).toEqual({ key: 'scheduling', name: 'Scheduling agent', autonomy: 'auto' })
  })

  it('includes the known-gaps list', async () => {
    const res = await GET()
    const body = await res.json()

    expect(body.data.knownGaps.length).toBeGreaterThan(0)
  })
})
