import { emitOpsEvent } from '@/lib/ops/events'
import { notifyShiftAssigned } from './notify-assignment'

type SupabaseAdmin = ReturnType<typeof import('@/lib/supabase/admin').createAdminClient>

export interface ScheduleAssignmentInput {
  shift_id: string
  staff_id: string
  staff_name?: string
}

export interface ApplyAssignmentsResult {
  applied: { shift_id: string; staff_name?: string }[]
  skipped: { shift_id: string; reason: string }[]
}

/**
 * The one place a proposed captain assignment actually becomes real — shared
 * by the human "Approve" click (admin/ghost/proposals/[id]/route.ts's
 * apply_schedule action) and the fully-automatic path (ops-drafters.ts, once
 * schedule_day reaches 'auto' autonomy). Extracted so both stay byte-for-byte
 * identical instead of two copies quietly drifting apart.
 *
 * Only ever touches a shift that's still OPEN with no captain — a manual
 * assignment made after the proposal was drafted always wins; this never
 * overwrites it. Logs an ops event per shift actually assigned (never for
 * one that was skipped).
 *
 * `opts.notify` (default true) controls whether the captain is DM'd right
 * now. The auto-execution path passes false — an assignment made days ahead
 * is provisional as more bookings land, so the DM waits for Beer's explicit
 * confirm (see admin/planning/ghost-activity/[id]/confirm) instead of
 * pinging the captain immediately, possibly more than once as the roster
 * shifts. Manual/approved assignments keep notifying immediately: a human
 * clicking "assign" IS the confirm moment already.
 */
export async function applyScheduleAssignments(
  supabase: SupabaseAdmin,
  assignments: ScheduleAssignmentInput[],
  actor: { actorType: 'human' | 'agent'; actorId?: string; proposalId?: string; source: string },
  opts?: { notify?: boolean },
): Promise<ApplyAssignmentsResult> {
  const notify = opts?.notify ?? true
  const applied: ApplyAssignmentsResult['applied'] = []
  const skipped: ApplyAssignmentsResult['skipped'] = []

  for (const a of assignments) {
    if (!a.shift_id || !a.staff_id) {
      skipped.push({ shift_id: a.shift_id || '?', reason: 'incomplete assignment (missing shift_id or staff_id)' })
      continue
    }

    const { data: updated } = await supabase
      .from('shifts')
      .update({ staff_id: a.staff_id, status: 'assigned' })
      .eq('id', a.shift_id)
      .eq('status', 'open')
      .is('staff_id', null)
      .select('id, booking_id')

    if (!updated?.length) {
      skipped.push({ shift_id: a.shift_id, reason: 'no longer open (manual change wins)' })
      continue
    }

    applied.push({ shift_id: a.shift_id, staff_name: a.staff_name })
    if (notify) {
      await notifyShiftAssigned(supabase, a.shift_id)
      await supabase.from('shifts').update({ notified_at: new Date().toISOString() }).eq('id', a.shift_id)
    }
    await emitOpsEvent({
      eventType: 'shift_assigned',
      actorType: actor.actorType,
      actorId: actor.actorId ?? null,
      bookingId: updated[0].booking_id ?? null,
      shiftId: a.shift_id,
      staffId: a.staff_id,
      proposalId: actor.proposalId ?? null,
      source: actor.source,
    })
  }

  return { applied, skipped }
}
