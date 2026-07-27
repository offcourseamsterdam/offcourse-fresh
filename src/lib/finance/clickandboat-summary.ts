import { quarterFromDate } from '@/lib/quarters'
import { splitVat } from '@/lib/finance/withlocals-summary'

export interface ClickAndBoatBookingSummaryInput {
  charterStartDate: string | null
  grossAmountCents: number | null
  netAmountCents: number | null // the VAT base — see note below
  revenueVatRate: number | null
}

export interface QuarterClickAndBoatSummary {
  quarter: string
  bookingCount: number
  grossAmountCents: number
  netAmountCents: number
  revenueExCents: number
  revenueVatCents: number // 9% output VAT (owed) — over the NET amount
}

export type ClickAndBoatSummaryTotals = Omit<QuarterClickAndBoatSummary, 'quarter'>

const DEFAULT_REVENUE_VAT_RATE = 9

/**
 * Buckets Click & Boat bookings by the quarter the charter happened
 * (charter_start_date). The 9% output VAT is derived from the NET amount
 * transferred to Off Course, NOT the gross renter total — Beer confirmed
 * this explicitly for Click & Boat. This is the opposite of Withlocals
 * (where the accountant confirmed 9% goes over the GROSS tour price) — the
 * two sources are NOT the same rule, don't unify them.
 *
 * `periodOf` defaults to quarterly bucketing but accepts any date->string
 * key (e.g. `monthFromDate`) so the BTW dashboard's per-month view reuses
 * this exact math instead of re-deriving it.
 */
export function aggregateClickAndBoatSummary(
  bookings: ClickAndBoatBookingSummaryInput[],
  periodOf: (date: string) => string = quarterFromDate
): { quarters: QuarterClickAndBoatSummary[]; totals: ClickAndBoatSummaryTotals } {
  const byQuarter = new Map<string, QuarterClickAndBoatSummary>()

  for (const b of bookings) {
    if (!b.charterStartDate) continue
    const quarter = periodOf(b.charterStartDate)
    const net = b.netAmountCents ?? 0
    const rate = b.revenueVatRate ?? DEFAULT_REVENUE_VAT_RATE
    const { exCents, vatCents } = splitVat(net, rate)

    const agg = byQuarter.get(quarter) ?? {
      quarter, bookingCount: 0, grossAmountCents: 0, netAmountCents: 0, revenueExCents: 0, revenueVatCents: 0,
    }
    agg.bookingCount += 1
    agg.grossAmountCents += b.grossAmountCents ?? 0
    agg.netAmountCents += net
    agg.revenueExCents += exCents
    agg.revenueVatCents += vatCents
    byQuarter.set(quarter, agg)
  }

  const quarters = [...byQuarter.values()].sort((a, b) => b.quarter.localeCompare(a.quarter))

  const totals = quarters.reduce<ClickAndBoatSummaryTotals>(
    (acc, q) => ({
      bookingCount: acc.bookingCount + q.bookingCount,
      grossAmountCents: acc.grossAmountCents + q.grossAmountCents,
      netAmountCents: acc.netAmountCents + q.netAmountCents,
      revenueExCents: acc.revenueExCents + q.revenueExCents,
      revenueVatCents: acc.revenueVatCents + q.revenueVatCents,
    }),
    { bookingCount: 0, grossAmountCents: 0, netAmountCents: 0, revenueExCents: 0, revenueVatCents: 0 }
  )

  return { quarters, totals }
}
