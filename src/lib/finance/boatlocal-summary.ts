import { quarterFromDate } from '@/lib/quarters'

export interface BoatLocalBatchSummaryInput {
  issueDate: string | null
  operatorPayoutCents: number | null
  vat9InPayoutCents: number | null
  /** 21% VAT on BoatLocal's own commission — input VAT, not output VAT owed on sales. */
  vat21Cents: number | null
  lineCount: number
}

export interface QuarterBoatLocalSummary {
  quarter: string
  batchCount: number
  bookingCount: number
  operatorPayoutCents: number
  vat9InPayoutCents: number
  vat21Cents: number
}

export interface BoatLocalSummaryTotals {
  batchCount: number
  bookingCount: number
  operatorPayoutCents: number
  vat9InPayoutCents: number
  vat21Cents: number
}

/**
 * Buckets BoatLocal payouts by the quarter the money actually arrived (issue
 * date — when the payout is transferred), same convention as the other
 * finance summaries.
 *
 * `periodOf` defaults to quarterly bucketing but accepts any date->string key
 * (e.g. `monthFromDate`) so the BTW dashboard's per-month view reuses this
 * exact math instead of re-deriving it — one VAT calculation, two grains.
 */
export function aggregateBoatLocalSummary(
  batches: BoatLocalBatchSummaryInput[],
  periodOf: (date: string) => string = quarterFromDate
): { quarters: QuarterBoatLocalSummary[]; totals: BoatLocalSummaryTotals } {
  const byQuarter = new Map<string, QuarterBoatLocalSummary>()

  for (const batch of batches) {
    if (!batch.issueDate) continue
    const quarter = periodOf(batch.issueDate)
    const existing = byQuarter.get(quarter) ?? {
      quarter, batchCount: 0, bookingCount: 0, operatorPayoutCents: 0, vat9InPayoutCents: 0, vat21Cents: 0,
    }
    existing.batchCount += 1
    existing.bookingCount += batch.lineCount
    existing.operatorPayoutCents += batch.operatorPayoutCents ?? 0
    existing.vat9InPayoutCents += batch.vat9InPayoutCents ?? 0
    existing.vat21Cents += batch.vat21Cents ?? 0
    byQuarter.set(quarter, existing)
  }

  const quarters = [...byQuarter.values()].sort((a, b) => b.quarter.localeCompare(a.quarter))

  const totals = quarters.reduce<BoatLocalSummaryTotals>(
    (acc, q) => ({
      batchCount: acc.batchCount + q.batchCount,
      bookingCount: acc.bookingCount + q.bookingCount,
      operatorPayoutCents: acc.operatorPayoutCents + q.operatorPayoutCents,
      vat9InPayoutCents: acc.vat9InPayoutCents + q.vat9InPayoutCents,
      vat21Cents: acc.vat21Cents + q.vat21Cents,
    }),
    { batchCount: 0, bookingCount: 0, operatorPayoutCents: 0, vat9InPayoutCents: 0, vat21Cents: 0 }
  )

  return { quarters, totals }
}
