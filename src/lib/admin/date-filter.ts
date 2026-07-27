export type DateCreatedFilter = 'all' | 'today' | 'week' | 'month' | 'quarter' | 'year'

/**
 * Midnight Amsterdam-local, as a Date, for the given Amsterdam-local Y/M/D.
 * `day` may be out of range (e.g. 0 or negative, from `day - daysBack` near a
 * month boundary) — the multi-arg Date constructor normalizes that correctly
 * (interpreted in the runtime's local timezone), unlike building an ISO string
 * first, which requires an already-valid calendar date and produces Invalid Date
 * otherwise. Shared by `dateCreatedThreshold` below and `getWeekStart` (week.ts).
 */
export function amsStartOf(year: number, month: number, day: number): Date {
  const ref = new Date(year, month, day, 0, 0, 0)
  const offset = ref.getTime() - new Date(ref.toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' })).getTime()
  return new Date(ref.getTime() + offset)
}

/**
 * Returns the start-of-period Date for a given date-created filter preset,
 * or null when the filter is 'all' (no threshold applied).
 *
 * All thresholds are floored to midnight Amsterdam time so that a booking
 * created at 09:00 today passes the "today" filter.
 *
 * @param filter - the active filter preset
 * @param now    - reference point (defaults to `new Date()`); injectable for testing
 */
export function dateCreatedThreshold(filter: DateCreatedFilter, now = new Date()): Date | null {
  if (filter === 'all') return null

  // Work in Amsterdam local time by computing the offset
  const ams = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }))

  const year = ams.getFullYear()
  const month = ams.getMonth()     // 0-based
  const day = ams.getDate()
  const dow = ams.getDay()         // 0 = Sunday

  // Build a "midnight Amsterdam" date, then convert to UTC for comparison.
  // `d` may be out of range (0 or negative — the 'week' case computes `day - daysBack`,
  // which goes negative whenever "today" is the 1st/2nd of the month on the right
  // weekday). The multi-arg Date constructor normalizes that correctly (interpreted in
  // the runtime's local timezone, same as the ISO-string version it replaces); building
  // an ISO string first would require an already-valid calendar date and would silently
  // produce an Invalid Date instead — which then makes every comparison against the
  // threshold evaluate to false, so the "This week" filter would show everything rather
  // than nothing.
  if (filter === 'today') return amsStartOf(year, month, day)

  if (filter === 'week') {
    // ISO week: Monday = day 1. If today is Sunday (0), step back 6 days.
    const daysBack = dow === 0 ? 6 : dow - 1
    return amsStartOf(year, month, day - daysBack)
  }

  if (filter === 'month') return amsStartOf(year, month, 1)

  if (filter === 'quarter') {
    const quarterStart = Math.floor(month / 3) * 3
    return amsStartOf(year, quarterStart, 1)
  }

  if (filter === 'year') return amsStartOf(year, 0, 1)

  return null
}
