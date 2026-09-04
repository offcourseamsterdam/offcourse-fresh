/**
 * What we owe the skippers, from our own scheduling data.
 *
 * A sailed shift is a debt the moment it ends, whether or not an invoice has
 * arrived. Waiting for the invoice makes the cockpit look richer than it is
 * for weeks, which is exactly the illusion this module removes.
 *
 * Two sources, in order of trust:
 *   1. a clocked time entry, with the hourly rate frozen at clock-in
 *   2. otherwise the scheduled shift, priced at the skipper's current rate
 *
 * A time entry always wins for its shift, so a shift that ran long is paid on
 * real hours rather than planned hours, and never counted twice.
 *
 * The output is one accrual per skipper per month, which is also the natural
 * unit for a payout run: one Revolut payment draft, one line per skipper.
 *
 * Pure.
 */

import { addMonths, type ISODate } from '../dates'

export interface SkipperShift {
  id: string
  staffId: string | null
  date: ISODate
  startAt: string
  endAt: string
  status: string
}

export interface SkipperTimeEntry {
  id: string
  staffId: string
  shiftId: string | null
  clockInAt: string
  clockOutAt: string | null
  /** Rate snapshot taken at clock-in; authoritative for this entry. */
  hourlyRateCents: number
}

export interface SkipperBonus {
  id: string
  staffId: string
  date: ISODate
  commissionCents: number
  note?: string | null
}

export interface SkipperRate {
  id: string
  name: string
  hourlyRateCents: number
  isActive: boolean
}

export interface SkipperMonthAccrual {
  key: string
  /** '2026-08' */
  month: string
  staffId: string
  staffName: string
  hours: number
  hourlyCostCents: number
  bonusCents: number
  amountCents: number
  shiftsCounted: number
  timeEntriesCounted: number
  /** The month has ended, so the total is final. */
  isClosed: boolean
  dueDate: ISODate
  /** Hours priced at a rate of zero, so the total understates what is owed. */
  unpricedHours: number
}

export interface SkipperAccrualResult {
  months: SkipperMonthAccrual[]
  totalOwedCents: number
  warnings: {
    /** Shifts that ran without anyone assigned; nobody to pay, nothing counted. */
    unassignedShifts: number
    /** Staff with an hourly rate of zero: their hours are counted but cost nothing. */
    staffWithoutRate: string[]
    /** Clocked in but never out; the shift's planned hours were used instead. */
    openTimeEntries: number
  }
}

export interface SkipperAccrualOptions {
  today: ISODate
  /** How long after a month ends the payout run happens. */
  dueDaysAfterMonth?: number
  /** Months already settled, e.g. '2026-07', excluded from the result. */
  settledMonths?: string[]
}

const MS_PER_HOUR = 3_600_000

function monthOf(date: string): string {
  return date.slice(0, 7)
}

function hoursBetween(from: string, to: string): number {
  const ms = Date.parse(to) - Date.parse(from)
  return ms > 0 ? ms / MS_PER_HOUR : 0
}

export function accrueSkipperHours(
  shifts: SkipperShift[],
  timeEntries: SkipperTimeEntry[],
  bonuses: SkipperBonus[],
  staff: SkipperRate[],
  opts: SkipperAccrualOptions,
): SkipperAccrualResult {
  const dueDays = opts.dueDaysAfterMonth ?? 7
  const settled = new Set(opts.settledMonths ?? [])
  const byStaffId = new Map(staff.map(s => [s.id, s]))

  const warnings = { unassignedShifts: 0, staffWithoutRate: [] as string[], openTimeEntries: 0 }
  const buckets = new Map<string, SkipperMonthAccrual>()

  const bucket = (staffId: string, month: string): SkipperMonthAccrual => {
    const key = `${month}:${staffId}`
    let b = buckets.get(key)
    if (!b) {
      const monthEnd = lastDayOfMonth(month)
      b = {
        key: `skipper:${key}`,
        month,
        staffId,
        staffName: byStaffId.get(staffId)?.name ?? 'Onbekende schipper',
        hours: 0, hourlyCostCents: 0, bonusCents: 0, amountCents: 0,
        shiftsCounted: 0, timeEntriesCounted: 0,
        isClosed: monthEnd < opts.today,
        dueDate: addDays(monthEnd, dueDays),
        unpricedHours: 0,
      }
      buckets.set(key, b)
    }
    return b
  }

  // A time entry supersedes its shift, so remember which shifts are spoken for.
  const shiftsCoveredByEntry = new Set<string>()
  for (const e of timeEntries) {
    if (e.shiftId) shiftsCoveredByEntry.add(e.shiftId)
  }

  for (const e of timeEntries) {
    if (!e.clockOutAt) { warnings.openTimeEntries++; if (e.shiftId) shiftsCoveredByEntry.delete(e.shiftId); continue }
    const month = monthOf(e.clockInAt)
    if (settled.has(month)) continue
    const b = bucket(e.staffId, month)
    const hours = hoursBetween(e.clockInAt, e.clockOutAt)
    b.hours += hours
    b.timeEntriesCounted++
    if (e.hourlyRateCents > 0) b.hourlyCostCents += Math.round(hours * e.hourlyRateCents)
    else b.unpricedHours += hours
  }

  for (const s of shifts) {
    if (s.status === 'cancelled') continue
    if (!s.staffId) { warnings.unassignedShifts++; continue }
    if (shiftsCoveredByEntry.has(s.id)) continue
    const month = monthOf(s.date)
    if (settled.has(month)) continue
    // Only shifts that have actually happened are a debt.
    if (s.date > opts.today) continue
    const b = bucket(s.staffId, month)
    const hours = hoursBetween(s.startAt, s.endAt)
    b.hours += hours
    b.shiftsCounted++
    const rate = byStaffId.get(s.staffId)?.hourlyRateCents ?? 0
    if (rate > 0) b.hourlyCostCents += Math.round(hours * rate)
    else b.unpricedHours += hours
  }

  for (const bonus of bonuses) {
    const month = monthOf(bonus.date)
    if (settled.has(month)) continue
    const b = bucket(bonus.staffId, month)
    b.bonusCents += bonus.commissionCents
  }

  for (const b of buckets.values()) {
    b.hours = Math.round(b.hours * 100) / 100
    b.unpricedHours = Math.round(b.unpricedHours * 100) / 100
    b.amountCents = b.hourlyCostCents + b.bonusCents
  }

  const named = new Set<string>()
  for (const b of buckets.values()) {
    if (b.unpricedHours > 0) named.add(b.staffName)
  }
  warnings.staffWithoutRate = [...named].sort()

  const months = [...buckets.values()]
    .filter(b => b.amountCents > 0 || b.unpricedHours > 0)
    .sort((a, b) => (a.month === b.month ? a.staffName.localeCompare(b.staffName) : a.month < b.month ? -1 : 1))

  return {
    months,
    totalOwedCents: months.reduce((s, m) => s + m.amountCents, 0),
    warnings,
  }
}

/**
 * One payout run: every skipper owed for a given month, as the lines of a
 * single Revolut payment draft. Skippers whose hours could not be priced are
 * listed separately rather than paid zero.
 */
export function buildPayoutRun(result: SkipperAccrualResult, month: string): {
  month: string
  lines: Array<{ staffId: string; staffName: string; amountCents: number; hours: number; reference: string }>
  totalCents: number
  blocked: Array<{ staffId: string; staffName: string; reason: string }>
} {
  const rows = result.months.filter(m => m.month === month)
  const lines = rows
    .filter(m => m.amountCents > 0 && m.unpricedHours === 0)
    .map(m => ({
      staffId: m.staffId,
      staffName: m.staffName,
      amountCents: m.amountCents,
      hours: m.hours,
      reference: `Uren ${month} (${m.hours} uur)`,
    }))
  const blocked = rows
    .filter(m => m.unpricedHours > 0)
    .map(m => ({ staffId: m.staffId, staffName: m.staffName, reason: `${m.unpricedHours} uur zonder uurtarief` }))
  return { month, lines, totalCents: lines.reduce((s, l) => s + l.amountCents, 0), blocked }
}

function lastDayOfMonth(month: string): ISODate {
  const [y, m] = month.split('-').map(Number)
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${month}-${String(day).padStart(2, '0')}`
}

function addDays(date: ISODate, days: number): ISODate {
  const t = new Date(`${date}T00:00:00Z`)
  t.setUTCDate(t.getUTCDate() + days)
  return t.toISOString().slice(0, 10)
}

export { addMonths }
