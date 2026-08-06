import type { createAdminClient } from '@/lib/supabase/admin'
import { syncShiftsForRange } from '@/lib/scheduling/sync-shifts'
import { draftOrAssignSchedule } from '@/lib/ghost/ops-drafters'
import { OPTIMIZE_HORIZON_DAYS } from '@/lib/ghost/rulebook'
import { amsterdamToday } from '@/lib/utils'

type AdminClient = ReturnType<typeof createAdminClient>

export interface ScheduleScanResult {
  date: string
  result: 'assigned' | 'drafted' | 'skipped'
}

/**
 * The daily proactive sweep: scans today through OPTIMIZE_HORIZON_DAYS days
 * out (the same horizon the ops-review/guest-move drafters already scan
 * nightly) and tries to fill every open shift it finds.
 *
 * There's no separate "1-2 days out" escalation path — a day within that
 * window gets re-scanned every single day as it approaches (same as
 * everything else in the horizon), so it naturally gets more attempts the
 * closer it gets. Combined with the reactive per-booking trigger
 * (syncAndScheduleShifts below), a shift is never waiting on this cron alone
 * to get noticed. Assumes the caller already synced shifts for the horizon
 * (the ghost-ops cron does this itself right before calling in).
 */
export async function runProactiveScheduling(): Promise<ScheduleScanResult[]> {
  const results: ScheduleScanResult[] = []
  for (let offset = 0; offset <= OPTIMIZE_HORIZON_DAYS; offset++) {
    const date = amsterdamToday(offset)
    results.push({ date, result: await draftOrAssignSchedule(date) })
  }
  return results
}

/**
 * The reactive half: sync this one date's shifts, THEN (only once that's
 * actually committed) try to fill any newly-open shift on it. Every
 * booking-confirmation path calls this instead of the bare
 * syncShiftsForRange, so a fresh booking's shift gets a captain the moment
 * it exists rather than waiting for tomorrow's cron. The two steps are
 * chained deliberately (not fired as separate siblings) — draftOrAssignSchedule
 * reads shifts straight from the database, so it must run strictly after the
 * sync's writes land or it would see the pre-sync (possibly shift-less) state.
 */
export async function syncAndScheduleShifts(supabase: AdminClient, date: string): Promise<void> {
  const sync = await syncShiftsForRange(supabase, date, date)
  if ('error' in sync) throw new Error(sync.error)
  await draftOrAssignSchedule(date)
}

/**
 * Same idea, for a multi-day range that's already been synced up front (the
 * manual admin Sync button syncs its whole [from, to] range in one call
 * rather than one date at a time — see admin/scheduling/sync/route.ts).
 * from/to are plain YYYY-MM-DD calendar dates, walked as UTC-midnight
 * instants purely so `+1 day` arithmetic is unambiguous — no timezone
 * conversion is involved, since a calendar date has no timezone of its own.
 */
export async function scheduleAcrossRange(from: string, to: string): Promise<void> {
  const cursor = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (cursor <= end) {
    await draftOrAssignSchedule(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
}
