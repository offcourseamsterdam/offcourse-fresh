import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/auth/require-cron-secret'
import { draftCateringOrders, draftCateringUpsells, draftTomorrowSchedule } from '@/lib/ghost/ops-drafters'
import { draftOpsReview } from '@/lib/ghost/ops-review'
import { draftGuestMoveRequest, expireStaleGuestMoves, OPTIMIZE_HORIZON_DAYS } from '@/lib/ghost/guest-move-drafter'
import { evaluateExpiredProposals } from '@/lib/ghost/evaluate'
import { syncShiftsForRange } from '@/lib/scheduling/sync-shifts'
import { createAdminClient } from '@/lib/supabase/admin'
import { amsterdamToday } from '@/lib/utils'
import { alertCronFailure } from '@/lib/cron/alert'

/**
 * Ghost ops cron — daily at 15:00 UTC (17:00 Amsterdam in summer).
 *
 * Step 1: sync bookings → shifts for today through the optimization horizon
 * (idempotent, the same generator the admin Sync button runs) so the drafters
 * below never reason over a stale roster — a booking that landed an hour ago
 * already has its shift by the time the optimizer looks, also two weeks out.
 *
 * Step 2: shadow-draft tomorrow's captain schedule, the upcoming catering
 * order, and the operations review. All status 'shadow': logged on
 * /admin/ghost, never executed, deduped per target date (a re-run is a no-op).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const denied = requireCronSecret(req)
  if (denied) return denied

  try {
    const sync = await syncShiftsForRange(createAdminClient(), amsterdamToday(), amsterdamToday(OPTIMIZE_HORIZON_DAYS))
    if ('error' in sync) {
      // Drafters still run — a sync failure degrades freshness, not correctness.
      console.error('[ghost-ops] shift sync failed:', sync.error)
    }

    // Learn first: score yesterday's unapproved drafts against reality, so
    // today's schedule draft can already read the fresh lessons.
    const evaluated = await evaluateExpiredProposals()

    const [schedule, catering, cateringUpsell, opsReview, expiredMoves] = await Promise.all([
      draftTomorrowSchedule(),
      draftCateringOrders(),
      draftCateringUpsells(),
      draftOpsReview(),
      expireStaleGuestMoves(),
    ])

    // After the ops review: draft at most ONE guest-move ask for tomorrow
    // (sequential outreach — see guest-move-drafter.ts hard rules).
    const guestMove = await draftGuestMoveRequest()

    return NextResponse.json({
      sync: 'error' in sync ? { error: sync.error } : sync,
      evaluated,
      schedule,
      catering,
      cateringUpsell,
      opsReview,
      guestMove,
      expiredMoves,
    })
  } catch (err) {
    // The drafters swallow their own per-item errors, but anything thrown at the
    // route level (e.g. a Supabase/Anthropic outage) would otherwise vanish.
    await alertCronFailure('ghost-ops', err)
    return NextResponse.json({ error: 'Ghost ops failed' }, { status: 500 })
  }
}
