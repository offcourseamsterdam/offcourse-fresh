/**
 * BTW (Dutch VAT) as a dated obligation, high and low rate combined.
 *
 * The actual VAT math — 9% on cruise revenue, 21% on extras/onboard sales,
 * per source, per quarter — already exists and is battle-tested:
 * `computeBtwDashboard()` in btw-dashboard-calculator.ts pulls every channel
 * (Stripe, BoatLocal, Withlocals, Click&Boat, GetYourGuide, Viator, GetMyBoat,
 * Barqo, Revolut, FareHarbor payouts) and nets them into one indication per
 * quarter. This module does not recompute any of that; it only turns the
 * result into obligations the cockpit's formula can subtract, the same way
 * city-tax.ts wraps the guest-count math instead of re-deriving it.
 *
 * A quarter with a net indication of zero or less is not proposed: a net
 * refund is not something we owe, and turning it into a €0 obligation would
 * just be noise.
 *
 * Pure. `computeBtwDashboard` does the (async, Supabase-backed) heavy lifting;
 * this only shapes its already-computed output.
 */

import { addMonths, type ISODate } from '../dates'
import type { QuarterBtwDashboard } from '@/lib/finance/btw-dashboard'

export interface VatObligationOptions {
  today: ISODate
  /** Months after the quarter ends the aangifte is due. Dutch BTW: end of the month after the quarter. */
  dueMonthsAfterQuarter?: number
}

export interface VatObligationProposal {
  key: string
  quarter: string
  title: string
  amountCents: number
  vat9Cents: number
  vat21Cents: number
  vat21DeductibleCents: number
  dueDate: ISODate
  isProvisional: boolean
}

function quarterEndDate(quarter: string): ISODate {
  const [yearStr, qStr] = quarter.split('-Q')
  const year = Number(yearStr)
  const q = Number(qStr)
  const endMonth = q * 3
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate()
  return `${year}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
}

function endOfMonth(date: ISODate): ISODate {
  const y = Number(date.slice(0, 4))
  const m = Number(date.slice(5, 7))
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${date.slice(0, 7)}-${String(day).padStart(2, '0')}`
}

function eur(cents: number): string {
  return new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 }).format(Math.round(cents / 100))
}

/**
 * Turns the already-computed quarterly BTW dashboard into obligation
 * proposals. Mirrors cityTaxObligations(): only quarters that actually owe
 * money, an open quarter is included but labelled as still accruing, and the
 * title names the high/low split so it reads the same way the BTW-aangifte
 * itself does.
 */
export function vatObligations(quarters: QuarterBtwDashboard[], opts: VatObligationOptions): VatObligationProposal[] {
  const dueMonths = opts.dueMonthsAfterQuarter ?? 1

  return quarters
    .filter(q => q.netIndicationCents > 0)
    .map(q => {
      const end = quarterEndDate(q.quarter)
      const isProvisional = end >= opts.today
      const parts: string[] = []
      if (q.vat9OwedCents > 0) parts.push(`€${eur(q.vat9OwedCents)} laag`)
      if (q.vat21OwedCents > 0) parts.push(`€${eur(q.vat21OwedCents)} hoog`)
      if (q.vat21DeductibleCents > 0) parts.push(`−€${eur(q.vat21DeductibleCents)} terug te vragen`)
      return {
        key: `vat:${q.quarter}`,
        quarter: q.quarter,
        title: isProvisional
          ? `BTW ${q.quarter}, loopt nog (${parts.join(', ')})`
          : `BTW ${q.quarter} (${parts.join(', ')})`,
        amountCents: q.netIndicationCents,
        vat9Cents: q.vat9OwedCents,
        vat21Cents: q.vat21OwedCents,
        vat21DeductibleCents: q.vat21DeductibleCents,
        dueDate: endOfMonth(addMonths(end, dueMonths)),
        isProvisional,
      }
    })
}
