/**
 * Calendar-date helpers for the cash cockpit.
 *
 * Everything in the cockpit works on ISO calendar dates ('YYYY-MM-DD') and does
 * its arithmetic in UTC, on purpose: a loan payment is due on "1 April", not on
 * "1 April 00:00 Europe/Amsterdam", and DST changes must never shift a day
 * count (the Investment Tracker this replaces had exactly that bug — see
 * loans/schedule.test.ts).
 */

export type ISODate = string // 'YYYY-MM-DD'

const MS_PER_DAY = 86_400_000

export function parseISODate(d: ISODate): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d)
  if (!m) throw new Error(`Invalid ISO date: ${d}`)
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
}

export function toISODate(d: Date): ISODate {
  return d.toISOString().slice(0, 10)
}

export function todayISO(now: Date = new Date()): ISODate {
  // The business runs on Amsterdam time; "today" is the Amsterdam calendar day.
  return now.toLocaleDateString('en-CA', { timeZone: 'Europe/Amsterdam' })
}

export function addDays(d: ISODate, days: number): ISODate {
  const t = parseISODate(d)
  return toISODate(new Date(t.getTime() + days * MS_PER_DAY))
}

/** Adds calendar months, clamping the day to the target month's length (Jan 31 + 1m = Feb 28). */
export function addMonths(d: ISODate, months: number): ISODate {
  const t = parseISODate(d)
  const y = t.getUTCFullYear()
  const m = t.getUTCMonth() + months
  const day = t.getUTCDate()
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  return toISODate(new Date(Date.UTC(y, m, Math.min(day, lastDay))))
}

/** Whole calendar days from a to b (b − a). Negative when b is before a. */
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / MS_PER_DAY)
}

export function compareISODate(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function maxISODate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b
}

/** Round to whole cents. Every intermediate money value in the cockpit passes through this. */
export function roundCents(n: number): number {
  return Math.round(n)
}
