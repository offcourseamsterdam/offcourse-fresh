/**
 * Week-boundary math for the admin Planning (week calendar) view. All
 * calculations run in Amsterdam local time so "today" lines up with what the
 * team sees on the wall clock, matching the pattern in date-filter.ts.
 */

/** Amsterdam-local YYYY-MM-DD for a given instant. */
export function amsDateString(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Europe/Amsterdam' })
}

/**
 * Midnight Amsterdam-local, as a Date, for the given Amsterdam-local Y/M/D.
 * `day` may be out of range (e.g. 0 or negative, from `day - daysBack` near a
 * month boundary) — the multi-arg Date constructor normalizes that correctly
 * (interpreted in the runtime's local timezone), unlike building an ISO string
 * first, which requires an already-valid calendar date and produces Invalid Date
 * otherwise. Mirrors the identical helper in date-filter.ts.
 */
function amsStartOf(year: number, month: number, day: number): Date {
  const ref = new Date(year, month, day, 0, 0, 0)
  const offset = ref.getTime() - new Date(ref.toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' })).getTime()
  return new Date(ref.getTime() + offset)
}

/** The Monday (00:00 Amsterdam-local) of the ISO week containing `date`. */
export function getWeekStart(date: Date): Date {
  const ams = new Date(date.toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }))
  const year = ams.getFullYear()
  const month = ams.getMonth()
  const day = ams.getDate()
  const dow = ams.getDay() // 0 = Sunday
  const daysBack = dow === 0 ? 6 : dow - 1
  return amsStartOf(year, month, day - daysBack)
}

/** Returns a new Date `days` days after `date` (calendar days, DST-safe enough for this UI). */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

/** The 7 Amsterdam-local YYYY-MM-DD strings (Mon–Sun) for the week starting at `weekStart`. */
export function weekDateStrings(weekStart: Date): string[] {
  return Array.from({ length: 7 }, (_, i) => amsDateString(addDays(weekStart, i)))
}

/** Human label for a week range, e.g. "6 – 12 Jul 2026" or "29 Jun – 5 Jul 2026" across a month boundary. */
export function formatWeekRangeLabel(weekStart: Date): string {
  const end = addDays(weekStart, 6)
  const startMonth = weekStart.toLocaleDateString('en-GB', { month: 'short', timeZone: 'Europe/Amsterdam' })
  const endMonth = end.toLocaleDateString('en-GB', { month: 'short', timeZone: 'Europe/Amsterdam' })
  const startDay = amsDateString(weekStart).slice(-2).replace(/^0/, '')
  const endDay = amsDateString(end).slice(-2).replace(/^0/, '')
  const endYear = amsDateString(end).slice(0, 4)
  return startMonth === endMonth
    ? `${startDay} – ${endDay} ${endMonth} ${endYear}`
    : `${startDay} ${startMonth} – ${endDay} ${endMonth} ${endYear}`
}
