// Combines VAT across every kasboek source into one per-quarter view, for
// the actual BTW-aangifte question: "what do I owe this quarter." Two VAT
// natures get kept separate rather than blended, because they behave
// differently in an aangifte:
//   - "owed" (verschuldigd) = output VAT on sales — money that flows TO the
//     Belastingdienst. 9% on cruise revenue (Stripe, BoatLocal, Withlocals),
//     21% on non-cruise sales (Stripe extras, Zettle onboard drinks/snacks).
//   - "deductible" (aftrekbaar) = input VAT on costs — money a business
//     normally reclaims. The 21% BoatLocal/Withlocals charge on THEIR
//     commission falls here — but whether it's actually deductible for Off
//     Course is an open question for the accountant, not something this
//     code decides. It's surfaced separately, never netted silently into an
//     "owed" figure the UI implies is final.

export interface BtwSourceQuarterInput {
  quarter: string
  vat9OwedCents?: number
  vat21OwedCents?: number
  vat21DeductibleCents?: number
}

export interface QuarterBtwDashboard {
  quarter: string
  vat9OwedCents: number
  vat21OwedCents: number
  vat21DeductibleCents: number
  /** vat9Owed + vat21Owed − vat21Deductible. An indication, not a filed aangifte. */
  netIndicationCents: number
  bySource: Record<string, { vat9OwedCents: number; vat21OwedCents: number; vat21DeductibleCents: number }>
}

export type BtwDashboardTotals = Omit<QuarterBtwDashboard, 'quarter' | 'bySource'>

/**
 * Merges per-source, per-quarter VAT rows (one array per source, each row
 * already bucketed to a quarter by its own source-specific logic) into a
 * single combined view. Sources are named so the UI can show a per-source
 * breakdown alongside the combined total.
 */
export function aggregateBtwDashboard(
  sourceRows: Record<string, BtwSourceQuarterInput[]>
): { quarters: QuarterBtwDashboard[]; totals: BtwDashboardTotals } {
  const byQuarter = new Map<string, QuarterBtwDashboard>()

  for (const [source, rows] of Object.entries(sourceRows)) {
    for (const row of rows) {
      const agg = byQuarter.get(row.quarter) ?? {
        quarter: row.quarter, vat9OwedCents: 0, vat21OwedCents: 0, vat21DeductibleCents: 0,
        netIndicationCents: 0, bySource: {},
      }
      const v9 = row.vat9OwedCents ?? 0
      const v21o = row.vat21OwedCents ?? 0
      const v21d = row.vat21DeductibleCents ?? 0
      agg.vat9OwedCents += v9
      agg.vat21OwedCents += v21o
      agg.vat21DeductibleCents += v21d
      agg.bySource[source] = {
        vat9OwedCents: (agg.bySource[source]?.vat9OwedCents ?? 0) + v9,
        vat21OwedCents: (agg.bySource[source]?.vat21OwedCents ?? 0) + v21o,
        vat21DeductibleCents: (agg.bySource[source]?.vat21DeductibleCents ?? 0) + v21d,
      }
      byQuarter.set(row.quarter, agg)
    }
  }

  for (const agg of byQuarter.values()) {
    agg.netIndicationCents = agg.vat9OwedCents + agg.vat21OwedCents - agg.vat21DeductibleCents
  }

  const quarters = [...byQuarter.values()].sort((a, b) => (a.quarter > b.quarter ? -1 : 1))

  const totals = quarters.reduce<BtwDashboardTotals>(
    (acc, q) => ({
      vat9OwedCents: acc.vat9OwedCents + q.vat9OwedCents,
      vat21OwedCents: acc.vat21OwedCents + q.vat21OwedCents,
      vat21DeductibleCents: acc.vat21DeductibleCents + q.vat21DeductibleCents,
      netIndicationCents: acc.netIndicationCents + q.netIndicationCents,
    }),
    { vat9OwedCents: 0, vat21OwedCents: 0, vat21DeductibleCents: 0, netIndicationCents: 0 }
  )

  return { quarters, totals }
}
