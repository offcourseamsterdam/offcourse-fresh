import { describe, it, expect, vi, beforeEach } from 'vitest'
import { applyScheduleAssignments } from './apply-assignments'
import { notifyShiftAssigned } from './notify-assignment'
import { emitOpsEvent } from '@/lib/ops/events'

vi.mock('./notify-assignment', () => ({ notifyShiftAssigned: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/ops/events', () => ({ emitOpsEvent: vi.fn().mockResolvedValue(undefined) }))

/**
 * Stubs just the `shifts` update chain `applyScheduleAssignments` issues per
 * assignment: `.update(...).eq('id', X).eq('status','open').is('staff_id',
 * null).select('id')`. `openShiftIds` is the set of shifts still open and
 * unassigned when the claim runs — anything else simulates "a manual change
 * already won" and resolves to no matched rows.
 */
function makeSupabase(openShiftIds: string[]) {
  const updateCalls: Array<{ shiftId?: string; payload: Record<string, unknown> }> = []
  let currentShiftId: string | undefined

  const from = vi.fn(() => ({
    update: vi.fn((payload: Record<string, unknown>) => {
      const call: { shiftId?: string; payload: Record<string, unknown> } = { payload, shiftId: undefined }
      updateCalls.push(call)

      // The notified_at stamp is a plain single-.eq() update, a different
      // (simpler) chain shape than the assignment claim below.
      if ('notified_at' in payload) {
        return {
          eq: vi.fn((_col: string, val: string) => {
            call.shiftId = val
            return Promise.resolve({ data: null, error: null })
          }),
        }
      }

      return {
        eq: vi.fn((col: string, val: string) => {
          if (col === 'id') currentShiftId = val
          call.shiftId = currentShiftId
          return {
            eq: vi.fn(() => ({
              is: vi.fn(() => ({
                select: vi.fn(() =>
                  Promise.resolve({
                    data: currentShiftId && openShiftIds.includes(currentShiftId) ? [{ id: currentShiftId }] : [],
                  }),
                ),
              })),
            })),
          }
        }),
      }
    }),
  }))

  return { client: { from }, updateCalls }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('applyScheduleAssignments', () => {
  it('assigns an open shift, notifies the captain, and logs a shift_assigned ops event', async () => {
    const sb = makeSupabase(['shift-1'])

    const result = await applyScheduleAssignments(
      sb.client as never,
      [{ shift_id: 'shift-1', staff_id: 'staff-1', staff_name: 'Joris' }],
      { actorType: 'human', proposalId: 'p1', source: 'test' },
    )

    expect(result.applied).toEqual([{ shift_id: 'shift-1', staff_name: 'Joris' }])
    expect(result.skipped).toEqual([])
    expect(notifyShiftAssigned).toHaveBeenCalledWith(sb.client, 'shift-1')
    // Notified by default (opts omitted) — stamped so the confirm-and-notify
    // flow later knows this one is already done.
    expect(sb.updateCalls.some(c => c.payload.notified_at && c.shiftId === 'shift-1')).toBe(true)
    expect(emitOpsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'shift_assigned',
        actorType: 'human',
        shiftId: 'shift-1',
        staffId: 'staff-1',
        proposalId: 'p1',
        source: 'test',
      }),
    )
  })

  it('notify:false assigns and logs the ops event but never DMs the captain or stamps notified_at', async () => {
    const sb = makeSupabase(['shift-1'])

    const result = await applyScheduleAssignments(
      sb.client as never,
      [{ shift_id: 'shift-1', staff_id: 'staff-1', staff_name: 'Joris' }],
      { actorType: 'agent', source: 'ghost/schedule_day:auto' },
      { notify: false },
    )

    expect(result.applied).toEqual([{ shift_id: 'shift-1', staff_name: 'Joris' }])
    expect(notifyShiftAssigned).not.toHaveBeenCalled()
    expect(sb.updateCalls.some(c => 'notified_at' in c.payload)).toBe(false)
    // The assignment itself and its audit trail still happen either way.
    expect(sb.updateCalls.some(c => c.payload.staff_id === 'staff-1' && c.shiftId === 'shift-1')).toBe(true)
    expect(emitOpsEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'shift_assigned', shiftId: 'shift-1' }))
  })

  it('notify:false never touches a shift that was skipped (no longer open)', async () => {
    const sb = makeSupabase([]) // nothing open: every claim loses

    await applyScheduleAssignments(
      sb.client as never,
      [{ shift_id: 'shift-1', staff_id: 'staff-1' }],
      { actorType: 'agent', source: 'test' },
      { notify: false },
    )

    expect(sb.updateCalls.some(c => 'notified_at' in c.payload)).toBe(false)
  })

  it('skips a shift that is no longer open — a manual assignment already won', async () => {
    const sb = makeSupabase([]) // nothing open: every claim loses

    const result = await applyScheduleAssignments(
      sb.client as never,
      [{ shift_id: 'shift-1', staff_id: 'staff-1' }],
      { actorType: 'agent', source: 'test' },
    )

    expect(result.applied).toEqual([])
    expect(result.skipped).toEqual([{ shift_id: 'shift-1', reason: 'no longer open (manual change wins)' }])
    expect(notifyShiftAssigned).not.toHaveBeenCalled()
    expect(emitOpsEvent).not.toHaveBeenCalled()
  })

  it('skips an incomplete assignment without touching the database', async () => {
    const sb = makeSupabase(['shift-1'])

    const result = await applyScheduleAssignments(
      sb.client as never,
      [{ shift_id: '', staff_id: 'staff-1' }],
      { actorType: 'agent', source: 'test' },
    )

    expect(result.skipped).toEqual([{ shift_id: '?', reason: 'incomplete assignment (missing shift_id or staff_id)' }])
    expect(sb.updateCalls).toHaveLength(0)
  })

  it('processes a mixed batch independently — one skip does not block the others', async () => {
    const sb = makeSupabase(['shift-1', 'shift-3'])

    const result = await applyScheduleAssignments(
      sb.client as never,
      [
        { shift_id: 'shift-1', staff_id: 'staff-1' },
        { shift_id: 'shift-2', staff_id: 'staff-2' },
        { shift_id: 'shift-3', staff_id: 'staff-3' },
      ],
      { actorType: 'agent', source: 'test' },
    )

    expect(result.applied.map(a => a.shift_id)).toEqual(['shift-1', 'shift-3'])
    expect(result.skipped.map(s => s.shift_id)).toEqual(['shift-2'])
    expect(notifyShiftAssigned).toHaveBeenCalledTimes(2)
    expect(emitOpsEvent).toHaveBeenCalledTimes(2)
  })

  it('tags each ops event with the actor fields passed in, not a hardcoded default', async () => {
    const sb = makeSupabase(['shift-1'])

    await applyScheduleAssignments(
      sb.client as never,
      [{ shift_id: 'shift-1', staff_id: 'staff-1' }],
      { actorType: 'agent', actorId: 'ops_optimizer', source: 'cron/proactive-scheduling' },
    )

    expect(emitOpsEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: 'agent', actorId: 'ops_optimizer', source: 'cron/proactive-scheduling', proposalId: null }),
    )
  })
})
