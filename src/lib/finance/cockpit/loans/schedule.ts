/**
 * Loan repayment schedule — port of the Investment Tracker engine
 * (docs: ~/Downloads/loancashflowexport.md, Part 1), with one deliberate
 * difference: day counts are calendar days in UTC, never DST-affected.
 *
 * Conventions (all verified against the exported schedules in schedule.test.ts):
 * - Payments fall on 1 April and 1 October. The first payment is the first
 *   fixed date strictly AFTER the start date (a loan starting exactly on
 *   1 April pays first on 1 October).
 * - totalPeriods = durationYears × 2; the first `interestFreeYears × 2`
 *   periods are interest-only.
 * - First period is pro-rated: days(start → first payment) / days(full period).
 * - Linear: equal principal over the repayment periods. Annuity: equal total
 *   payment over the repayment periods. Interest-only: bullet at the end.
 * - Tranches (staggered payout): interest is computed day-accurately per
 *   balance segment; principal per period is based on the total tranche sum.
 * - Every amount is rounded to cents at every step; the final period sweeps
 *   any remaining balance so the schedule always ends at exactly zero.
 */

import { addDays, daysBetween, parseISODate, roundCents, toISODate, type ISODate } from '../dates'

export type RepaymentType = 'linear' | 'annuity' | 'interest_only'

export interface LoanTranche {
  amountCents: number
  date: ISODate
  note?: string
}

export interface LoanTerms {
  principalCents: number
  interestRatePct: number
  durationYears: number
  interestFreeYears: number
  repaymentType: RepaymentType
  startDate: ISODate
  tranches?: LoanTranche[]
}

export interface SchedulePeriod {
  index: number
  dueDate: ISODate
  /** Balance the interest was computed on (before this period's repayment). */
  openingBalanceCents: number
  interestCents: number
  principalCents: number
  totalCents: number
  closingBalanceCents: number
  interestFree: boolean
}

export interface LoanSchedule {
  periods: SchedulePeriod[]
  endDate: ISODate
  totalInterestCents: number
  totalPaidCents: number
}

// ── Fixed payment calendar ───────────────────────────────────────────────────

/** The first fixed payment date strictly after `date`. */
export function nextPaymentDate(date: ISODate): ISODate {
  const y = parseISODate(date).getUTCFullYear()
  const apr = `${y}-04-01`
  const oct = `${y}-10-01`
  if (date < apr) return apr
  if (date < oct) return oct
  return `${y + 1}-04-01`
}

/** The fixed payment date immediately before `paymentDate` (six months earlier). */
export function previousPaymentDate(paymentDate: ISODate): ISODate {
  const d = parseISODate(paymentDate)
  const y = d.getUTCFullYear()
  return paymentDate.endsWith('-04-01') ? `${y - 1}-10-01` : `${y}-04-01`
}

export function paymentDateAfter(paymentDate: ISODate): ISODate {
  const d = parseISODate(paymentDate)
  const y = d.getUTCFullYear()
  return paymentDate.endsWith('-04-01') ? `${y}-10-01` : `${y + 1}-04-01`
}

// ── Schedule ─────────────────────────────────────────────────────────────────

export function buildSchedule(loan: LoanTerms): LoanSchedule {
  const tranches = [...(loan.tranches ?? [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const hasTranches = tranches.length > 0
  const principalTotal = hasTranches
    ? tranches.reduce((s, t) => s + t.amountCents, 0)
    : loan.principalCents
  if (hasTranches && principalTotal !== loan.principalCents) {
    throw new Error(`Tranches (${principalTotal}) do not add up to the principal (${loan.principalCents})`)
  }

  const totalPeriods = loan.durationYears * 2
  const interestFreePeriods = Math.min(totalPeriods, loan.interestFreeYears * 2)
  const repaymentPeriods = totalPeriods - interestFreePeriods
  const semiAnnualRate = loan.interestRatePct / 100 / 2
  const dailyRate = loan.interestRatePct / 100 / 365

  const startDate = hasTranches ? tranches[0].date : loan.startDate
  const firstDue = nextPaymentDate(startDate)
  const fullPeriodDays = daysBetween(previousPaymentDate(firstDue), firstDue)
  const firstPeriodDays = daysBetween(startDate, firstDue)
  const proRata = Math.min(1, Math.max(0, firstPeriodDays / fullPeriodDays))

  const linearPrincipal = repaymentPeriods > 0 ? principalTotal / repaymentPeriods : 0
  const annuity = repaymentPeriods > 0 && semiAnnualRate > 0
    ? principalTotal * (semiAnnualRate * Math.pow(1 + semiAnnualRate, repaymentPeriods)) / (Math.pow(1 + semiAnnualRate, repaymentPeriods) - 1)
    : linearPrincipal

  const periods: SchedulePeriod[] = []
  // Balance already disbursed (steps up as tranches land). Without tranches the
  // whole principal is out from day one.
  let balance = hasTranches ? 0 : principalTotal
  let trancheIdx = 0
  let periodStart = startDate
  let dueDate = firstDue

  for (let i = 0; i < totalPeriods; i++) {
    const isLast = i === totalPeriods - 1
    const interestFree = i < interestFreePeriods

    let interest: number
    if (hasTranches) {
      // Day-accurate segmented interest: balance changes at each tranche date inside the period.
      let segStart = periodStart
      let segBalance = balance
      let acc = 0
      while (trancheIdx < tranches.length && tranches[trancheIdx].date < dueDate) {
        const t = tranches[trancheIdx]
        if (t.date > segStart) {
          acc += segBalance * dailyRate * daysBetween(segStart, t.date)
          segStart = t.date
        }
        segBalance += t.amountCents
        trancheIdx++
      }
      acc += segBalance * dailyRate * daysBetween(segStart, dueDate)
      balance = segBalance
      interest = roundCents(acc)
    } else {
      interest = roundCents(balance * semiAnnualRate * (i === 0 ? proRata : 1))
    }
    const openingBalance = balance

    let principal: number
    if (isLast) {
      principal = balance // sweep whatever is left (rounding drift, bullet loans, tranche timing)
    } else if (interestFree) {
      principal = 0
    } else if (loan.repaymentType === 'interest_only') {
      principal = 0
    } else if (loan.repaymentType === 'annuity') {
      principal = roundCents(Math.min(balance, annuity - interest))
    } else {
      principal = roundCents(Math.min(balance, linearPrincipal))
    }

    balance = roundCents(balance - principal)
    periods.push({
      index: i,
      dueDate,
      openingBalanceCents: openingBalance,
      interestCents: interest,
      principalCents: principal,
      totalCents: interest + principal,
      closingBalanceCents: balance,
      interestFree,
    })
    periodStart = dueDate
    dueDate = paymentDateAfter(dueDate)
  }

  return {
    periods,
    endDate: periods[periods.length - 1]?.dueDate ?? firstDue,
    totalInterestCents: periods.reduce((s, p) => s + p.interestCents, 0),
    totalPaidCents: periods.reduce((s, p) => s + p.totalCents, 0),
  }
}

/** Sum interest/principal per calendar year — the shape the Investment Tracker export uses. */
export function scheduleByYear(schedule: LoanSchedule): Array<{ year: number; interestCents: number; principalCents: number; totalCents: number }> {
  const map = new Map<number, { year: number; interestCents: number; principalCents: number; totalCents: number }>()
  for (const p of schedule.periods) {
    const year = Number(p.dueDate.slice(0, 4))
    const row = map.get(year) ?? { year, interestCents: 0, principalCents: 0, totalCents: 0 }
    row.interestCents += p.interestCents
    row.principalCents += p.principalCents
    row.totalCents += p.totalCents
    map.set(year, row)
  }
  return [...map.values()].sort((a, b) => a.year - b.year)
}

/** Outstanding balance on a given date, according to the schedule (payments assumed on time). */
export function outstandingOn(schedule: LoanSchedule, date: ISODate): number {
  let balance = schedule.periods[0]?.openingBalanceCents ?? 0
  for (const p of schedule.periods) {
    if (p.dueDate <= date) balance = p.closingBalanceCents
    else break
  }
  return balance
}

export { addDays, toISODate }
