import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ requireAdmin: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/auth/require-admin', () => ({ requireAdmin: h.requireAdmin }))
vi.mock('@/lib/scheduling/notify-assignment', () => ({ notifyShiftAssigned: vi.fn().mockResolvedValue(undefined) }))

import { POST } from './route'
import { notifyShiftAssigned } from '@/lib/scheduling/notify-assignment'
import { createAdminClient } from '@/lib/supabase/admin'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

/**
 * `proposal` seeds the agent_proposals lookup; `shifts` seeds the shifts
 * lookup keyed by id. `.update()` on shifts is captured so tests can assert
 * exactly which shifts got notified_at stamped.
 */
function makeSupabase({
  proposal,
  shifts,
}: {
  proposal: { kind: string; status: string; payload: unknown } | null
  shifts: { id: string; staff_id: string | null; notified_at: string | null }[]
}) {
  const updatedShiftIds: string[] = []
  const from = vi.fn((table: string) => {
    if (table === 'agent_proposals') {
      return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: proposal }) }) }) }
    }
    if (table === 'shifts') {
      return {
        select: () => ({ in: () => Promise.resolve({ data: shifts }) }),
        update: (payload: Record<string, unknown>) => ({
          eq: (_col: string, val: string) => {
            if ('notified_at' in payload) updatedShiftIds.push(val)
            return Promise.resolve({ data: null, error: null })
          },
        }),
      }
    }
    throw new Error(`unexpected table: ${table}`)
  })
  return { client: { from }, updatedShiftIds }
}

function makeReq(id: string) {
  return [{} as never, { params: Promise.resolve({ id }) }] as const
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/admin/planning/ghost-activity/[id]/confirm', () => {
  it('returns 400 for a non-schedule_day proposal', async () => {
    const sb = makeSupabase({ proposal: { kind: 'catering_order', status: 'executed', payload: {} }, shifts: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(...makeReq('p1'))
    expect(res.status).toBe(400)
  })

  it('returns 409 for a proposal that was never auto-executed', async () => {
    const sb = makeSupabase({ proposal: { kind: 'schedule_day', status: 'shadow', payload: {} }, shifts: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(...makeReq('p1'))
    expect(res.status).toBe(409)
  })

  it('notifies every unnotified assigned shift and stamps notified_at', async () => {
    const sb = makeSupabase({
      proposal: { kind: 'schedule_day', status: 'executed', payload: { assignments: [{ shift_id: 's1' }, { shift_id: 's2' }] } },
      shifts: [
        { id: 's1', staff_id: 'cap1', notified_at: null },
        { id: 's2', staff_id: 'cap2', notified_at: null },
      ],
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(...makeReq('p1'))
    const body = await res.json()

    expect(body.data).toEqual({ notified: 2, alreadyNotified: 0, skipped: 0 })
    expect(notifyShiftAssigned).toHaveBeenCalledTimes(2)
    expect(notifyShiftAssigned).toHaveBeenCalledWith(sb.client, 's1')
    expect(notifyShiftAssigned).toHaveBeenCalledWith(sb.client, 's2')
    expect(sb.updatedShiftIds.sort()).toEqual(['s1', 's2'])
  })

  it('skips a shift already notified — does not re-DM the captain', async () => {
    const sb = makeSupabase({
      proposal: { kind: 'schedule_day', status: 'executed', payload: { assignments: [{ shift_id: 's1' }] } },
      shifts: [{ id: 's1', staff_id: 'cap1', notified_at: '2026-08-06T12:00:00Z' }],
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(...makeReq('p1'))
    const body = await res.json()

    expect(body.data).toEqual({ notified: 0, alreadyNotified: 1, skipped: 0 })
    expect(notifyShiftAssigned).not.toHaveBeenCalled()
  })

  it('skips a shift that was reassigned away (no staff_id) since auto-assignment, without notifying anyone', async () => {
    const sb = makeSupabase({
      proposal: { kind: 'schedule_day', status: 'executed', payload: { assignments: [{ shift_id: 's1' }] } },
      shifts: [{ id: 's1', staff_id: null, notified_at: null }],
    })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(...makeReq('p1'))
    const body = await res.json()

    expect(body.data).toEqual({ notified: 0, alreadyNotified: 0, skipped: 1 })
    expect(notifyShiftAssigned).not.toHaveBeenCalled()
  })

  it('returns zero counts for a proposal with no assignments, without querying shifts', async () => {
    const sb = makeSupabase({ proposal: { kind: 'schedule_day', status: 'executed', payload: { assignments: [] } }, shifts: [] })
    vi.mocked(createAdminClient).mockReturnValue(sb.client as never)

    const res = await POST(...makeReq('p1'))
    const body = await res.json()

    expect(body.data).toEqual({ notified: 0, alreadyNotified: 0, skipped: 0 })
  })
})
