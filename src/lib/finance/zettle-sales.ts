import { quarterFromDate } from '@/lib/quarters'

/**
 * One month of Zettle (PayPal POS) onboard sales, read off the my.zettle.com
 * "Verkoopdetails" page. All money is integer cents. `month` is an ISO date
 * string for the first of the month, e.g. "2025-06-01".
 *
 * `cashCountedCents` is the one field NOT read off the page — it's Beer's own
 * physical cash count, entered by hand so it can be checked against
 * `cashZettleCents` (what Zettle itself reports).
 */
export interface ZettleMonthInput {
  month: string
  totalInclVatCents: number | null
  totalExclVatCents: number | null
  saleCount: number | null
  vat9ExclCents: number | null
  vat9VatCents: number | null
  vat9InclCents: number | null
  vat21ExclCents: number | null
  vat21VatCents: number | null
  vat21InclCents: number | null
  totalVatCents: number | null
  cardGrossCents: number | null
  cardSurchargeCents: number | null
  cardNetCents: number | null
  cashZettleCents: number | null
  cashCountedCents: number | null
}

export interface QuarterZettleSummary {
  quarter: string
  monthCount: number
  totalInclVatCents: number
  totalVatCents: number
  vat9VatCents: number
  vat21VatCents: number
  cardGrossCents: number
  cardSurchargeCents: number
  cardNetCents: number
  cashZettleCents: number
  cashCountedCents: number
  /** counted − Zettle, summed over the months in this quarter that have a count. */
  cashDiffCents: number
  /** How many months in this quarter still have no manual cash count entered. */
  cashUncountedMonths: number
}

export type ZettleSummaryTotals = Omit<QuarterZettleSummary, 'quarter'>

/**
 * Buckets Zettle months by the quarter the sales happened (the `month` itself),
 * same quarterly convention as the other finance summaries. Cash reconciliation
 * only counts months where a manual count was actually entered — months still
 * awaiting a count are surfaced via `cashUncountedMonths` rather than being
 * silently treated as a €0 discrepancy.
 */
export function aggregateZettleSummary(
  months: ZettleMonthInput[]
): { quarters: QuarterZettleSummary[]; totals: ZettleSummaryTotals } {
  const byQuarter = new Map<string, QuarterZettleSummary>()

  for (const m of months) {
    if (!m.month) continue
    const quarter = quarterFromDate(m.month)
    const agg = byQuarter.get(quarter) ?? {
      quarter, monthCount: 0, totalInclVatCents: 0, totalVatCents: 0,
      vat9VatCents: 0, vat21VatCents: 0, cardGrossCents: 0, cardSurchargeCents: 0, cardNetCents: 0,
      cashZettleCents: 0, cashCountedCents: 0, cashDiffCents: 0, cashUncountedMonths: 0,
    }
    agg.monthCount += 1
    agg.totalInclVatCents += m.totalInclVatCents ?? 0
    agg.totalVatCents += m.totalVatCents ?? 0
    agg.vat9VatCents += m.vat9VatCents ?? 0
    agg.vat21VatCents += m.vat21VatCents ?? 0
    agg.cardGrossCents += m.cardGrossCents ?? 0
    agg.cardSurchargeCents += m.cardSurchargeCents ?? 0
    agg.cardNetCents += m.cardNetCents ?? 0
    agg.cashZettleCents += m.cashZettleCents ?? 0
    if (m.cashCountedCents == null) {
      agg.cashUncountedMonths += 1
    } else {
      agg.cashCountedCents += m.cashCountedCents
      agg.cashDiffCents += m.cashCountedCents - (m.cashZettleCents ?? 0)
    }
    byQuarter.set(quarter, agg)
  }

  const quarters = [...byQuarter.values()].sort((a, b) => b.quarter.localeCompare(a.quarter))

  const totals = quarters.reduce<ZettleSummaryTotals>((acc, q) => ({
    monthCount: acc.monthCount + q.monthCount,
    totalInclVatCents: acc.totalInclVatCents + q.totalInclVatCents,
    totalVatCents: acc.totalVatCents + q.totalVatCents,
    vat9VatCents: acc.vat9VatCents + q.vat9VatCents,
    vat21VatCents: acc.vat21VatCents + q.vat21VatCents,
    cardGrossCents: acc.cardGrossCents + q.cardGrossCents,
    cardSurchargeCents: acc.cardSurchargeCents + q.cardSurchargeCents,
    cardNetCents: acc.cardNetCents + q.cardNetCents,
    cashZettleCents: acc.cashZettleCents + q.cashZettleCents,
    cashCountedCents: acc.cashCountedCents + q.cashCountedCents,
    cashDiffCents: acc.cashDiffCents + q.cashDiffCents,
    cashUncountedMonths: acc.cashUncountedMonths + q.cashUncountedMonths,
  }), {
    monthCount: 0, totalInclVatCents: 0, totalVatCents: 0, vat9VatCents: 0,
    vat21VatCents: 0, cardGrossCents: 0, cardSurchargeCents: 0, cardNetCents: 0,
    cashZettleCents: 0, cashCountedCents: 0, cashDiffCents: 0, cashUncountedMonths: 0,
  })

  return { quarters, totals }
}
