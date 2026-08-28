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

const proposals = [
  { id: 'p1', payload: { target_date: '2099-01-01' } }, // far future — always counts
  { id: 'p2', payload: { target_date: '2000-01-01' } }, // in the past — should not count
  { id: 'p3', payload: {} }, // no target_date — should not count
]

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === 'conversations') {
        return { select: () => ({ eq: () => Promise.resolve({ count: 5, error: null }) }) }
      }
      if (table === 'agent_proposals') {
        return {
          select: () => ({
            eq: () => ({ in: () => ({ order: () => ({ limit: () => Promise.resolve({ data: proposals, error: null }) }) }) }),
          }),
        }
      }
      throw new Error(`unexpected table "${table}"`)
    },
  }),
}))

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  h.requireAdmin.mockResolvedValue(null)
  h.getNextAvailabilityRequestDate.mockReturnValue({
    targetMonth: '2026-10',
    targetMonthStart: '2026-10-01',
    triggerDate: '2026-08-20',
    daysUntil: 12,
  })
  h.getNextScheduleDigestAt.mockReturnValue('2026-08-08T16:00:00.000Z')
})

describe('GET /api/admin/ghost/upcoming', () => {
  it('returns open chat count, awaiting-review count (future target_date only), and the two next cadence times', async () => {
    const res = await GET()
    const json = await res.json()

    expect(json.data).toEqual({
      openChatsCount: 5,
      awaitingReviewCount: 1,
      nextScheduleDigestAt: '2026-08-08T16:00:00.000Z',
      nextAvailabilityRequest: {
        targetMonth: '2026-10',
        targetMonthStart: '2026-10-01',
        triggerDate: '2026-08-20',
        daysUntil: 12,
      },
    })
  })

  it('rejects unauthenticated requests', async () => {
    const denied = new Response('denied', { status: 401 })
    h.requireAdmin.mockResolvedValue(denied)

    const res = await GET()

    expect(res).toBe(denied)
  })
})
