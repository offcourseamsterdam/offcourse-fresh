import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { syncShiftsForRange } from '@/lib/scheduling/sync-shifts'
import { runProactiveScheduling } from '@/lib/scheduling/proactive-scheduling'
import { OPTIMIZE_HORIZON_DAYS } from '@/lib/ghost/rulebook'
import { amsterdamToday } from '@/lib/utils'

/**
 * POST /api/admin/planning/find-captains
 *
 * The on-demand version of the nightly ghost-ops cron's scheduling step —
 * "check everything right now" instead of waiting for 15:00 UTC. Syncs
 * shifts for the full horizon (today → OPTIMIZE_HORIZON_DAYS) then runs the
 * same proactive scan. Synchronous (not backgrounded): a manual click wants
 * to see what happened, not a silent fire-and-forget.
 *
 * Still assign-now/notify-later underneath (applyScheduleAssignments'
 * notify:false in the auto path) — this never DMs a captain by itself; that
 * still waits for Beer's explicit confirm in the Ghost Activity panel.
 */
export async function POST() {
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const supabase = createAdminClient()
    const from = amsterdamToday()
    const to = amsterdamToday(OPTIMIZE_HORIZON_DAYS)

    const sync = await syncShiftsForRange(supabase, from, to)
    if ('error' in sync) return apiError(sync.error)

    const results = await runProactiveScheduling()
    const summary = {
      assigned: results.filter(r => r.result === 'assigned').length,
      drafted: results.filter(r => r.result === 'drafted').length,
      skipped: results.filter(r => r.result === 'skipped').length,
    }

    return apiOk({ summary, results })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
