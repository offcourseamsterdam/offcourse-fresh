/**
 * Week-boundary math for the admin Planning (week calendar) view. All
 * calculations run in Amsterdam local time so "today" lines up with what the
 * team sees on the wall clock, matching the pattern in date-filter.ts.
 */

import { toAmsDateStr } from '@/lib/utils'
import { amsStartOf } from './date-filter'

export { toAmsDateStr as amsDateString }

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

/** The Amsterdam-local YYYY-MM-DD strings for `days` consecutive days (default
 *  7, Mon–Sun) starting at `weekStart`. Pass a multiple of 7 to span several
 *  weeks — the Planning view's "show more days" span selector does this. */
export function weekDateStrings(weekStart: Date, days = 7): string[] {
  return Array.from({ length: days }, (_, i) => toAmsDateStr(addDays(weekStart, i)))
}

/** Human label for a date range of `days` days (default 7), e.g.
 *  "6 – 12 Jul 2026" or "29 Jun – 5 Jul 2026" across a month boundary. */
export function formatWeekRangeLabel(weekStart: Date, days = 7): string {
  const end = addDays(weekStart, days - 1)
  const startMonth = weekStart.toLocaleDateString('en-GB', { month: 'short', timeZone: 'Europe/Amsterdam' })
  const endMonth = end.toLocaleDateString('en-GB', { month: 'short', timeZone: 'Europe/Amsterdam' })
  const startDay = toAmsDateStr(weekStart).slice(-2).replace(/^0/, '')
  const endDay = toAmsDateStr(end).slice(-2).replace(/^0/, '')
  const endYear = toAmsDateStr(end).slice(0, 4)
  return startMonth === endMonth
    ? `${startDay} – ${endDay} ${endMonth} ${endYear}`
    : `${startDay} ${startMonth} – ${endDay} ${endMonth} ${endYear}`
}
