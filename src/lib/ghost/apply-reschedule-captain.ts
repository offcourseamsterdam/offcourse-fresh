import { syncShiftsForRange } from '@/lib/scheduling/sync-shifts'
import { applyScheduleAssignments } from '@/lib/scheduling/apply-assignments'
import { draftOrAssignSchedule } from '@/lib/ghost/ops-drafters'

type SupabaseAdmin = ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>

/**
 * After an approved reschedule_request has moved a booking, bring the shifts
 * in line and put the captain the proposal chose on the new shift.
 *
 * Order matters, which is why the rebook route is told to skip its own
 * background sync (deferShiftSync): sync both days first, THEN place the
 * chosen captain, THEN let the normal scheduler fill anything still open.
 * Two syncs running at once could both create the new day's shift.
 *
 * The captain is placed through applyScheduleAssignments, so the same rule as
 * every other assignment holds: only a shift that is still open with nobody
 * on it is touched, and a human's assignment always wins. notify:false —
 * per Beer, this flow sends Slack only to him, never to captains; the
 * captain hears about the new shift through the normal confirm flow.
 */

export interface CaptainDecision {
  action?: string
  current?: string | null
  proposed?: string | null
  proposed_staff_id?: string | null
}

export interface ShiftSnapshot {
  id: string
  staff_id: string | null
  status: string
}

export type CaptainPlan =
  | { kind: 'assign'; staffId: string }
  | { kind: 'skip'; note: string }

/**
 * Which captain (if any) to place, given the decision, the captain who was on
 * the booking BEFORE the move, the active captains, and the new shift.
 * `keep` trusts the pre-move shift's captain over the model's id: that is the
 * database's own answer to "who was on it".
 */
export function planCaptain(
  decision: CaptainDecision | undefined,
  previousCaptainId: string | null,
  activeStaff: { id: string; name: string }[],
  newShift: ShiftSnapshot | null,
): CaptainPlan {
  const action = decision?.action
  if (action === 'none_available') return { kind: 'skip', note: 'No captain free — the new shift is left open for the scheduler or a human.' }
  if (!newShift) return { kind: 'skip', note: 'No shift found for the moved booking yet — assign a captain in Planning.' }

  let staffId: string | null = null
  if (action === 'keep') staffId = previousCaptainId ?? decision?.proposed_staff_id ?? null
  else if (action === 'swap') {
    staffId = decision?.proposed_staff_id ?? null
    if (!staffId && decision?.proposed) {
      const byName = activeStaff.filter(s => s.name.toLowerCase() === decision.proposed!.toLowerCase())
      if (byName.length === 1) staffId = byName[0].id
    }
  }
  if (!staffId) return { kind: 'skip', note: 'The proposal named no captain we could identify — assign one in Planning.' }
  if (!activeStaff.some(s => s.id === staffId)) return { kind: 'skip', note: 'The chosen captain is not an active captain anymore — assign one in Planning.' }

  const name = activeStaff.find(s => s.id === staffId)?.name ?? 'the chosen captain'
  if (newShift.staff_id === staffId) return { kind: 'skip', note: `${name} is already on the new shift.` }
  if (newShift.staff_id || newShift.status !== 'open') {
    return { kind: 'skip', note: `The new shift already has a captain; left as is. Change it in Planning if ${name} should take it.` }
  }
  return { kind: 'assign', staffId }
}

/** The shift covering a booking on a date: via shift_bookings, falling back to the legacy shifts.booking_id link. */
export async function findShiftForBooking(supabase: SupabaseAdmin, bookingId: string, date: string): Promise<ShiftSnapshot | null> {
  const { data: linked } = await supabase
    .from('shifts')
    .select('id, staff_id, status, shift_bookings!inner(booking_id)')
    .eq('date', date)
    .eq('shift_bookings.booking_id', bookingId)
    .neq('status', 'cancelled')
    .limit(1)
  if (linked?.length) return { id: linked[0].id, staff_id: linked[0].staff_id, status: linked[0].status }
  const { data: legacy } = await supabase
    .from('shifts')
    .select('id, staff_id, status')
    .eq('date', date)
    .eq('booking_id', bookingId)
    .neq('status', 'cancelled')
    .limit(1)
  return legacy?.[0] ?? null
}

export async function applyRescheduleShifts(
  supabase: SupabaseAdmin,
  opts: {
    bookingId: string
    oldDate: string | null
    newDate: string
    previousCaptainId: string | null
    decision: CaptainDecision | undefined
    proposalId: string
  },
): Promise<{ captain: 'assigned' | 'skipped'; note: string }> {
  const dates = [...new Set([opts.oldDate, opts.newDate].filter(Boolean) as string[])]
  for (const d of dates) {
    const res = await syncShiftsForRange(supabase, d, d)
    if ('error' in res) throw new Error(`Shift sync failed for ${d}: ${res.error}`)
  }

  const [{ data: staff }, newShift] = await Promise.all([
    supabase.from('staff').select('id, name').eq('is_active', true),
    findShiftForBooking(supabase, opts.bookingId, opts.newDate),
  ])
  const plan = planCaptain(opts.decision, opts.previousCaptainId, staff ?? [], newShift)

  let result: { captain: 'assigned' | 'skipped'; note: string }
  if (plan.kind === 'assign' && newShift) {
    const name = staff?.find(s => s.id === plan.staffId)?.name
    const applied = await applyScheduleAssignments(
      supabase,
      [{ shift_id: newShift.id, staff_id: plan.staffId, staff_name: name }],
      { actorType: 'human', proposalId: opts.proposalId, source: 'admin/ghost/proposals/[id]:reschedule_booking' },
      { notify: false },
    )
    result = applied.applied.length
      ? { captain: 'assigned', note: `${name ?? 'Captain'} is on the new shift.` }
      : { captain: 'skipped', note: 'The new shift was taken in the meantime; left as is.' }
  } else {
    result = { captain: 'skipped', note: plan.kind === 'skip' ? plan.note : 'Nothing to assign.' }
  }

  // Let the normal scheduler fill whatever is still open on either day.
  for (const d of dates) await draftOrAssignSchedule(d).catch(err => console.error('[reschedule] scheduling failed for', d, err))
  return result
}
