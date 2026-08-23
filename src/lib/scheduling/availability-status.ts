import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * "Has this captain filled in month X yet?" — the shared question behind both
 * the follow-up nudge (cron/availability-request) and the admin overview
 * (/api/admin/scheduling/availability-status).
 *
 * A captain counts as having RESPONDED once they have at least one
 * staff_availability row in the month. Marking a single day is a deliberate
 * act, and the calendar's tap-cycle means "unset" is indistinguishable from
 * "never opened it" — so any row at all is the only honest signal that they
 * engaged. It deliberately does NOT mean "every day is accounted for":
 * chasing someone who marked 20 of 31 days would be nagging, not reminding.
 */

export interface CaptainMonthStatus {
  staffId: string
  name: string
  slackMemberId: string | null
  slackNotificationsEnabled: boolean
  /** Days with an explicit status set in the month (any of the three). */
  daysFilled: number
  /** True once they've marked at least one day — see the doc comment. */
  hasResponded: boolean
}

/** First and last day of a YYYY-MM month, as YYYY-MM-DD. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number)
  // Day 0 of the NEXT month is the last day of this one — avoids a
  // leap-year/31-day lookup table.
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` }
}

/**
 * Per-active-captain fill status for one month. Two queries, not one per
 * captain: all active staff, then every availability row in the month,
 * counted in memory — this runs on an admin page load and in a daily cron,
 * so an N+1 here would be a self-inflicted wound.
 */
export async function getMonthAvailabilityStatus(
  supabase: AdminClient,
  month: string,
): Promise<CaptainMonthStatus[]> {
  const { from, to } = monthRange(month)

  const [staffRes, availRes] = await Promise.all([
    supabase
      .from('staff')
      .select('id, name, slack_member_id, slack_notifications_enabled')
      .eq('is_active', true)
      .order('name'),
    supabase.from('staff_availability').select('staff_id').gte('date', from).lte('date', to),
  ])

  const countByStaff = new Map<string, number>()
  for (const row of availRes.data ?? []) {
    countByStaff.set(row.staff_id, (countByStaff.get(row.staff_id) ?? 0) + 1)
  }

  return (staffRes.data ?? []).map(s => {
    const daysFilled = countByStaff.get(s.id) ?? 0
    return {
      staffId: s.id,
      name: s.name,
      slackMemberId: s.slack_member_id,
      // Column is nullable; only an explicit `false` means "never message me"
      // (matches notify-assignment.ts's own check exactly).
      slackNotificationsEnabled: s.slack_notifications_enabled !== false,
      daysFilled,
      hasResponded: daysFilled > 0,
    }
  })
}

/** The captain-facing availability calendar, opened to a specific month. */
export function captainAvailabilityUrl(siteUrl: string, locale = 'en'): string {
  return `${siteUrl.replace(/\/$/, '')}/${locale}/captain/availability`
}
