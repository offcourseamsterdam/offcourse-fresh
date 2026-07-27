import { quarterFromDate } from '@/lib/quarters'
import { splitVat } from '@/lib/finance/withlocals-summary'

export interface GetMyBoatBookingSummaryInput {
  charterDate: string | null
  netAmountCents: number | null // the VAT base — see note below
  revenueVatRate: number | null
}

export interface QuarterGetMyBoatSummary {
  quarter: string
  bookingCount: number
  netAmountCents: number
  revenueExCents: number
  revenueVatCents: number // 9% output VAT (owed) — over the NET amount
}

export type GetMyBoatSummaryTotals = Omit<QuarterGetMyBoatSummary, 'quarter'>

const DEFAULT_REVENUE_VAT_RATE = 9

/**
 * Buckets Getmyboat bookings by the quarter the charter happened
 * (charter_date). 9% output VAT is derived from the NET amount Getmyboat
 * actually pays out — Beer confirmed this explicitly, same convention as
 * Click & Boat/GetYourGuide/Viator (Withlocals is the one exception that
 * uses the gross tour price instead). There's no gross figure to reference
 * here even for display — the payout email only ever states the net amount,
 * unlike Click & Boat's CSV which has both.
 *
 * `periodOf` defaults to quarterly bucketing but accepts any date->string
 * key (e.g. `monthFromDate`) so the BTW dashboard's per-month view reuses
 * this exact math instead of re-deriving it.
 */
export function aggregateGetMyBoatSummary(
  bookings: GetMyBoatBookingSummaryInput[],
  periodOf: (date: string) => string = quarterFromDate
): { quarters: QuarterGetMyBoatSummary[]; totals: GetMyBoatSummaryTotals } {
  const byQuarter = new Map<string, QuarterGetMyBoatSummary>()

  for (const b of bookings) {
    if (!b.charterDate) continue
    const quarter = periodOf(b.charterDate)
    const net = b.netAmountCents ?? 0
    const rate = b.revenueVatRate ?? DEFAULT_REVENUE_VAT_RATE
    const { exCents, vatCents } = splitVat(net, rate)

    const agg = byQuarter.get(quarter) ?? {
      quarter, bookingCount: 0, netAmountCents: 0, revenueExCents: 0, revenueVatCents: 0,
    }
    agg.bookingCount += 1
    agg.netAmountCents += net
    agg.revenueExCents += exCents
    agg.revenueVatCents += vatCents
    byQuarter.set(quarter, agg)
  }

  const quarters = [...byQuarter.values()].sort((a, b) => b.quarter.localeCompare(a.quarter))

  const totals = quarters.reduce<GetMyBoatSummaryTotals>(
    (acc, q) => ({
      bookingCount: acc.bookingCount + q.bookingCount,
      netAmountCents: acc.netAmountCents + q.netAmountCents,
      revenueExCents: acc.revenueExCents + q.revenueExCents,
      revenueVatCents: acc.revenueVatCents + q.revenueVatCents,
    }),
    { bookingCount: 0, netAmountCents: 0, revenueExCents: 0, revenueVatCents: 0 }
  )

  return { quarters, totals }
}
