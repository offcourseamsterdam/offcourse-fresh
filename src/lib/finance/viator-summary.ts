import { quarterFromDate } from '@/lib/quarters'
import { splitVat } from '@/lib/finance/withlocals-summary'

export interface ViatorBatchSummaryInput {
  adviceDate: string | null
  totalAmountCents: number | null
  lineCount: number
  revenueVatRate: number | null
}

export interface QuarterViatorSummary {
  quarter: string
  batchCount: number
  bookingCount: number
  totalAmountCents: number
  revenueExCents: number
  revenueVatCents: number // 9% output VAT (owed) — over the net payout, same convention as Click & Boat/GetYourGuide
}

export type ViatorSummaryTotals = Omit<QuarterViatorSummary, 'quarter'>

const DEFAULT_REVENUE_VAT_RATE = 9

/**
 * Buckets Viator payment batches by the quarter the money actually arrived
 * (advice_date — the bank-transfer date), not any individual booking's sail
 * date. Mirrors aggregateVatStripeSummary's quarter convention.
 *
 * Viator's payment advice does not break out VAT or its own commission —
 * totalAmountCents (per line, summed to the batch total) is simply the net
 * amount Viator pays out, no gross customer price anywhere on the document.
 * 9% output VAT is derived from that net total — Beer confirmed this basis,
 * reversing an earlier "international company, no 9%" assumption. The split
 * is applied at the batch level (not per booking line) since that's the
 * granularity this aggregator already works at — mathematically equivalent
 * to summing a per-line split, just without compounding per-line rounding.
 *
 * `periodOf` defaults to quarterly bucketing but accepts any date->string
 * key (e.g. `monthFromDate`) so the BTW dashboard's per-month view reuses
 * this exact math instead of re-deriving it.
 */
export function aggregateViatorSummary(
  batches: ViatorBatchSummaryInput[],
  periodOf: (date: string) => string = quarterFromDate
): { quarters: QuarterViatorSummary[]; totals: ViatorSummaryTotals } {
  const byQuarter = new Map<string, QuarterViatorSummary>()

  for (const batch of batches) {
    if (!batch.adviceDate) continue
    const quarter = periodOf(batch.adviceDate)
    const net = batch.totalAmountCents ?? 0
    const rate = batch.revenueVatRate ?? DEFAULT_REVENUE_VAT_RATE
    const { exCents, vatCents } = splitVat(net, rate)

    const existing = byQuarter.get(quarter) ?? {
      quarter, batchCount: 0, bookingCount: 0, totalAmountCents: 0, revenueExCents: 0, revenueVatCents: 0,
    }
    existing.batchCount += 1
    existing.bookingCount += batch.lineCount
    existing.totalAmountCents += net
    existing.revenueExCents += exCents
    existing.revenueVatCents += vatCents
    byQuarter.set(quarter, existing)
  }

  const quarters = [...byQuarter.values()].sort((a, b) => b.quarter.localeCompare(a.quarter))

  const totals = quarters.reduce<ViatorSummaryTotals>(
    (acc, q) => ({
      batchCount: acc.batchCount + q.batchCount,
      bookingCount: acc.bookingCount + q.bookingCount,
      totalAmountCents: acc.totalAmountCents + q.totalAmountCents,
      revenueExCents: acc.revenueExCents + q.revenueExCents,
      revenueVatCents: acc.revenueVatCents + q.revenueVatCents,
    }),
    { batchCount: 0, bookingCount: 0, totalAmountCents: 0, revenueExCents: 0, revenueVatCents: 0 }
  )

  return { quarters, totals }
}
