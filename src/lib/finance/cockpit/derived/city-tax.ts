/**
 * City tax as a dated obligation.
 *
 * Amsterdam's day-trip tax is charged to the guest at checkout and then sits
 * in the bank account until it is remitted. That makes it the clearest case
 * in the whole cockpit of money that is present but not ours: without this,
 * a quarter of collected tax reads as free room for growth.
 *
 * Two things make the quarterly split non-obvious:
 *
 *   1. The yearly exemption (the first N guests fleet-wide) is consumed
 *      chronologically, so it does not divide evenly. An early quarter can owe
 *      nothing at all while the allowance lasts, and the quarter in which it
 *      runs out owes only for the guests past the threshold.
 *   2. Bookings from channels that never reach our own table are invisible
 *      here. src/lib/finance/city-tax.ts documents exactly which and why, and
 *      this module carries that shortfall forward rather than quietly rounding
 *      the number up to look complete.
 *
 * Pure. Turning these into rows in finance_obligations is the caller's job.
 */

import { CITY_TAX_CENTS_PER_GUEST, CITY_TAX_FREE_GUESTS_PER_YEAR } from '@/lib/booking/constants'
import { addMonths, type ISODate } from '../dates'

const ACTIVE_STATUSES = new Set(['confirmed', 'booked'])

export interface CityTaxBooking {
  id: string
  bookingUuid: string | null
  bookingDate: ISODate | null
  guestCount: number | null
  status: string | null
  bookingSource: string | null
  isShadow?: boolean
}

export interface CityTaxQuarter {
  /** '2026-Q3' */
  key: string
  year: number
  quarter: 1 | 2 | 3 | 4
  periodStart: ISODate
  periodEnd: ISODate
  /** Guests counted in this quarter, before the exemption. */
  guests: number
  /** Guests in this quarter still covered by the yearly exemption. */
  exemptGuests: number
  /** Guests actually charged. */
  taxableGuests: number
  amountCents: number
  dueDate: ISODate
  /** The quarter has ended, so the amount is final. */
  isClosed: boolean
}

export interface CityTaxAccrual {
  quarters: CityTaxQuarter[]
  totalOwedCents: number
  /** Bookings we know we cannot see, so the total is a floor and not a fact. */
  excluded: {
    notActive: number
    noGuestCount: number
    untrackedSources: string[]
  }
}

export interface CityTaxOptions {
  year: number
  today: ISODate
  centsPerGuest?: number
  freeGuestsPerYear?: number
  /**
   * How many months after the quarter ends the payment is due; the deadline
   * itself is the last day of that month, following the Dutch convention for
   * period levies. The gemeente's own deadline is not encoded anywhere in this
   * repo, so it is a setting rather than a hard-coded fact: change it once and
   * every quarter follows.
   */
  dueMonthsAfterQuarter?: number
  untrackedSources?: readonly string[]
}

export function quarterOf(date: ISODate): 1 | 2 | 3 | 4 {
  const month = Number(date.slice(5, 7))
  return (Math.floor((month - 1) / 3) + 1) as 1 | 2 | 3 | 4
}

export function quarterBounds(year: number, quarter: 1 | 2 | 3 | 4): { start: ISODate; end: ISODate } {
  const startMonth = (quarter - 1) * 3 + 1
  const start = `${year}-${String(startMonth).padStart(2, '0')}-01`
  const endMonth = startMonth + 2
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate()
  return { start, end: `${year}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}` }
}

/** Last calendar day of the month a date falls in. */
function endOfMonth(date: ISODate): ISODate {
  const y = Number(date.slice(0, 4))
  const m = Number(date.slice(5, 7))
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${date.slice(0, 7)}-${String(day).padStart(2, '0')}`
}

/** De-duplicates the way the kasboek aggregator does: prefer the authoritative row. */
function dedupe(rows: CityTaxBooking[]): CityTaxBooking[] {
  const singles: CityTaxBooking[] = []
  const byUuid = new Map<string, CityTaxBooking[]>()
  for (const r of rows) {
    if (!r.bookingUuid) { singles.push(r); continue }
    const group = byUuid.get(r.bookingUuid)
    if (group) group.push(r)
    else byUuid.set(r.bookingUuid, [r])
  }
  const out = [...singles]
  for (const group of byUuid.values()) out.push(group.find(r => !r.isShadow) ?? group[0])
  return out
}

export function accrueCityTax(rows: CityTaxBooking[], opts: CityTaxOptions): CityTaxAccrual {
  const centsPerGuest = opts.centsPerGuest ?? CITY_TAX_CENTS_PER_GUEST
  const freeGuests = opts.freeGuestsPerYear ?? CITY_TAX_FREE_GUESTS_PER_YEAR
  const dueMonths = opts.dueMonthsAfterQuarter ?? 1
  const untracked = new Set((opts.untrackedSources ?? []).map(s => s.toLowerCase()))

  const inYear = dedupe(rows.filter(r => r.bookingDate?.startsWith(String(opts.year))))

  let notActive = 0
  let noGuestCount = 0
  const untrackedSeen = new Set<string>()
  const guestsByQuarter = new Map<number, number>()

  // Chronological order matters: the exemption is consumed as the year runs.
  const counted = inYear
    .filter(r => {
      if (!r.status || !ACTIVE_STATUSES.has(r.status)) { notActive++; return false }
      if (r.guestCount == null) { noGuestCount++; return false }
      return true
    })
    .sort((a, b) => (a.bookingDate! < b.bookingDate! ? -1 : a.bookingDate! > b.bookingDate! ? 1 : 0))

  for (const r of inYear) {
    const source = (r.bookingSource ?? '').toLowerCase()
    if (untracked.has(source)) untrackedSeen.add(source)
  }

  for (const r of counted) {
    const q = quarterOf(r.bookingDate!)
    guestsByQuarter.set(q, (guestsByQuarter.get(q) ?? 0) + (r.guestCount ?? 0))
  }

  let allowanceLeft = freeGuests
  const quarters: CityTaxQuarter[] = []
  for (const q of [1, 2, 3, 4] as const) {
    const guests = guestsByQuarter.get(q) ?? 0
    const exempt = Math.min(guests, allowanceLeft)
    allowanceLeft -= exempt
    const taxable = guests - exempt
    const { start, end } = quarterBounds(opts.year, q)
    quarters.push({
      key: `${opts.year}-Q${q}`,
      year: opts.year,
      quarter: q,
      periodStart: start,
      periodEnd: end,
      guests,
      exemptGuests: exempt,
      taxableGuests: taxable,
      amountCents: taxable * centsPerGuest,
      dueDate: endOfMonth(addMonths(end, dueMonths)),
      isClosed: end < opts.today,
    })
  }

  return {
    quarters,
    totalOwedCents: quarters.reduce((s, q) => s + q.amountCents, 0),
    excluded: { notActive, noGuestCount, untrackedSources: [...untrackedSeen].sort() },
  }
}

/**
 * The quarters that should exist as obligations: anything with an amount that
 * has not been paid yet. A quarter still running is included too, because the
 * money is already in the account and pretending otherwise is the exact error
 * this module exists to prevent. Its title says it is still accruing.
 */
export function cityTaxObligations(accrual: CityTaxAccrual): Array<{
  key: string
  title: string
  amountCents: number
  dueDate: ISODate
  isProvisional: boolean
}> {
  return accrual.quarters
    .filter(q => q.amountCents > 0)
    .map(q => ({
      key: `city-tax:${q.key}`,
      title: q.isClosed
        ? `Toeristenbelasting ${q.key} (${q.taxableGuests} gasten)`
        : `Toeristenbelasting ${q.key}, loopt nog (${q.taxableGuests} gasten tot nu toe)`,
      amountCents: q.amountCents,
      dueDate: q.dueDate,
      isProvisional: !q.isClosed,
    }))
}
