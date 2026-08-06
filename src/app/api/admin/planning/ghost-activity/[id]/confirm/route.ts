import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { notifyShiftAssigned } from '@/lib/scheduling/notify-assignment'

/**
 * POST /api/admin/planning/ghost-activity/[id]/confirm
 *
 * The other half of the assign-now/notify-later split (see
 * applyScheduleAssignments' `notify` option): a captain the proactive
 * scheduler auto-assigned only gets DM'd once Beer clicks this, from the
 * Ghost Activity panel. Reads each assignment's shift fresh from the
 * database rather than trusting the proposal's stored payload — if a human
 * reassigned the shift after the auto-assignment, the DM correctly goes to
 * whoever is actually on it now, or is skipped if it's unassigned again.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const { id } = await params
    const supabase = createAdminClient()

    const { data: proposal } = await supabase
      .from('agent_proposals')
      .select('id, kind, status, payload')
      .eq('id', id)
      .single()
    if (!proposal || proposal.kind !== 'schedule_day') return apiError('Not a schedule proposal', 400)
    if (proposal.status !== 'executed') return apiError('This proposal was never auto-executed — nothing to confirm.', 409)

    const payload = (proposal.payload ?? {}) as { assignments?: { shift_id?: string }[] }
    const shiftIds = (payload.assignments ?? []).map(a => a.shift_id).filter((s): s is string => !!s)
    if (!shiftIds.length) return apiOk({ notified: 0, alreadyNotified: 0, skipped: 0 })

    const { data: shifts } = await supabase
      .from('shifts')
      .select('id, staff_id, notified_at')
      .in('id', shiftIds)

    let notified = 0
    let alreadyNotified = 0
    let skipped = 0
    for (const shift of shifts ?? []) {
      if (shift.notified_at) {
        alreadyNotified++
        continue
      }
      if (!shift.staff_id) {
        skipped++ // reassigned away (no longer anyone to tell) since auto-assignment
        continue
      }
      await notifyShiftAssigned(supabase, shift.id)
      await supabase.from('shifts').update({ notified_at: new Date().toISOString() }).eq('id', shift.id)
      notified++
    }

    return apiOk({ notified, alreadyNotified, skipped })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
