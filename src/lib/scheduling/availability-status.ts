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
  /** Days with an explicit status set in the month (either one). */
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

export type AvailabilityStatusValue = 'available' | 'unavailable'

export interface DayAvailabilityEntry {
  status: AvailabilityStatusValue
  /** HH:MM, or null on "all day" (the default) or on 'unavailable'. */
  startTime: string | null
  endTime: string | null
}

export interface DayAvailability {
  /** YYYY-MM-DD */
  date: string
  byStaffId: Record<string, DayAvailabilityEntry>
}

/**
 * What to actually show for a day: 'available' with a time window set reads
 * as "partly available", not plain "available" — Beer, 2026-08-23: "available,
 * or partly available. if people make it red we know not to call them for
 * last minutes". One function so the captain's own calendar and the admin
 * day-by-day grid can never draw this distinction differently.
 */
export type AvailabilityDisplay = 'available' | 'partly_available' | 'unavailable' | 'unset'

export function availabilityDisplay(entry: DayAvailabilityEntry | null | undefined): AvailabilityDisplay {
  if (!entry) return 'unset'
  if (entry.status === 'unavailable') return 'unavailable'
  return entry.startTime && entry.endTime ? 'partly_available' : 'available'
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** Expands "HH:MM"-"HH:MM" into a [start, end) range on a 0-2879 timeline,
 *  pushing `end` past 1440 when it's not after `start` — the same "wraps to
 *  the next day" reading a person gives a range like "22:00-00:30". */
function expandRange(start: string, end: string): { start: number; end: number } {
  const s = toMinutes(start)
  const e = toMinutes(end)
  return { start: s, end: e > s ? e : e + 24 * 60 }
}

/**
 * Does a shift fit entirely inside a captain's stated hours? Both the shift
 * and the availability window may cross midnight (Beer, 2026-08-24: a late
 * cruise ending at "12:30" — half past midnight, not a full overnight shift,
 * but real enough that captains need to log it). The shift is anchored to
 * whichever day-segment of the window it actually falls in, so a window like
 * "22:00-00:30" lines up correctly whether the shift itself is "22:00-23:30"
 * or "23:30-00:30".
 */
export function shiftFitsAvailabilityWindow(
  shiftStart: string,
  shiftEnd: string,
  windowStart: string,
  windowEnd: string,
): boolean {
  const win = expandRange(windowStart, windowEnd)
  const shift = expandRange(shiftStart, shiftEnd)
  const anchored = shift.start < win.start ? { start: shift.start + 24 * 60, end: shift.end + 24 * 60 } : shift
  return anchored.start >= win.start && anchored.end <= win.end
}

/**
 * The captain calendar's tap cycle: unset → available → unavailable → unset.
 * Exported and tested on its own — a silent change to this order is exactly
 * the kind of thing that wouldn't show up until a captain is mid-tap and
 * confused. 'available' is only ever reached FROM 'unset', which never has
 * an hours window, so the cycle itself never needs to carry one forward —
 * hours are set separately, via the day's own hours editor.
 */
export const AVAILABILITY_TAP_CYCLE: Record<'unset' | AvailabilityStatusValue, AvailabilityStatusValue | null> = {
  unset: 'available',
  available: 'unavailable',
  unavailable: null,
}

const VALID_STATUS = new Set<string>(['available', 'unavailable'])

/**
 * Day-by-day, every captain at once — Beer, 2026-08-23: "I also want to see
 * the calendar where I can see everyone's availability each day", distinct
 * from getMonthAvailabilityStatus's "has each captain responded at all" —
 * this answers "who's actually around on the 15th", which matters when
 * you're the one deciding who to ask for a shift.
 *
 * A separate query from getMonthAvailabilityStatus (not folded into it,
 * even though both read staff_availability for the same month) so the cron
 * path — which only ever needs the response-count summary — never pays for
 * or depends on the per-day shape.
 */
export async function getMonthAvailabilityGrid(supabase: AdminClient, month: string): Promise<DayAvailability[]> {
  const { from, to } = monthRange(month)
  const { data } = await supabase
    .from('staff_availability')
    .select('staff_id, date, status, start_time, end_time')
    .gte('date', from)
    .lte('date', to)

  const byDate = new Map<string, Record<string, DayAvailabilityEntry>>()
  for (const row of data ?? []) {
    if (!VALID_STATUS.has(row.status)) continue // defensive — column is free-text, not an enum
    const entry = byDate.get(row.date) ?? {}
    entry[row.staff_id] = {
      status: row.status as AvailabilityStatusValue,
      // Postgres TIME comes back as "HH:MM:SS" — trim to "HH:MM" (same as
      // the captain-facing GET route) so callers never see the seconds.
      startTime: row.start_time?.slice(0, 5) ?? null,
      endTime: row.end_time?.slice(0, 5) ?? null,
    }
    byDate.set(row.date, entry)
  }

  const lastDay = Number(to.slice(-2))
  return Array.from({ length: lastDay }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, '0')}`
    return { date, byStaffId: byDate.get(date) ?? {} }
  })
}

/** The captain-facing availability calendar, opened to a specific month. */
export function captainAvailabilityUrl(siteUrl: string, locale = 'en'): string {
  return `${siteUrl.replace(/\/$/, '')}/${locale}/captain/availability`
}
