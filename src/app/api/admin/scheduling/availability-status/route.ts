import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { getMonthAvailabilityStatus, getMonthAvailabilityGrid } from '@/lib/scheduling/availability-status'
import { getNextAvailabilityRequestDate } from '@/lib/scheduling/availability-request'

/**
 * GET /api/admin/scheduling/availability-status?month=YYYY-MM
 *
 * Two views of the same month, fetched together since the page always wants
 * both: who has and hasn't responded at all (Beer, 2026-08-23 — there was no
 * way to see this; the reminder cron knew, but nothing surfaced it), and
 * day-by-day, everyone at once (Beer, same day: "I also want to see the
 * calendar where I can see everyone's availability each day" — a different
 * question, who's actually around on a given day, not just who's responded).
 * Also returns when the next automatic request goes out.
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const month = new URL(request.url).searchParams.get('month')
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return apiError('month (YYYY-MM) is required', 400)
    }

    const supabase = createAdminClient()
    const [captains, days] = await Promise.all([
      getMonthAvailabilityStatus(supabase, month),
      getMonthAvailabilityGrid(supabase, month),
    ])
    const next = getNextAvailabilityRequestDate()

    return apiOk({
      month,
      captains,
      days,
      responded: captains.filter(c => c.hasResponded).length,
      total: captains.length,
      /** Captains who can never be reached by the reminder as things stand. */
      unreachable: captains.filter(c => !c.slackMemberId || !c.slackNotificationsEnabled).length,
      nextRequest: next,
    })
  } catch (err) {
    return apiError(err instanceof Error ? err.message : 'Unknown error')
  }
}
