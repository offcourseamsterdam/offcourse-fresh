import type { NextRequest } from 'next/server'
import { apiOk, apiError } from '@/lib/api/response'
import { requireAdmin } from '@/lib/auth/require-admin'
import { createAdminClient } from '@/lib/supabase/admin'
import { getMonthAvailabilityStatus } from '@/lib/scheduling/availability-status'
import { getNextAvailabilityRequestDate } from '@/lib/scheduling/availability-request'

/**
 * GET /api/admin/scheduling/availability-status?month=YYYY-MM
 *
 * Who has and hasn't filled in their availability for a month (Beer,
 * 2026-08-23 — there was no way to see this at all; the reminder cron knew,
 * but nothing surfaced it). Also returns when the next automatic request
 * goes out, so the page can say "chased automatically on X" instead of
 * leaving you wondering whether to nudge people yourself.
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const month = new URL(request.url).searchParams.get('month')
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return apiError('month (YYYY-MM) is required', 400)
    }

    const captains = await getMonthAvailabilityStatus(createAdminClient(), month)
    const next = getNextAvailabilityRequestDate()

    return apiOk({
      month,
      captains,
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
