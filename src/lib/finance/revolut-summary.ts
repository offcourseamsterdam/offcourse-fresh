import { quarterFromDate } from '@/lib/quarters'
import { splitVat } from '@/lib/finance/withlocals-summary'

// Revolut ("Rederij Zoomers & Schenk" Business account) is a direct sales
// channel like Stripe/Zettle, not a marketplace taking a commission — so
// both the 9% (cruise) and 21% (drinks/merch) VAT are OWED (verschuldigd),
// same as Zettle. There's no deductible commission bucket here at all.
//
// Bucketing uses `payoutDate` — when Revolut actually transferred the money
// to the bank (derived in revolut-statement.ts by replaying the account's
// own Transfer history) — NOT `occurredAt` (when the customer paid). A
// transaction not yet swept into a Transfer has no payoutDate yet and is
// tracked separately (`unpaidCount`/`unpaidAmountCents`), never bucketed
// into a quarter it hasn't actually landed in.
//
// Separately, every transaction still needs vat9GrossCents/vat21GrossCents
// to be manually classified before it contributes any VAT — see
// revolut-statement.ts for why free-text descriptions can't be trusted to
// auto-classify. A transaction can be paid out but still unclassified (or,
// in principle, classified before being paid out) — these are two
// independent gates, tracked separately.

export interface RevolutTransactionSummaryInput {
  payoutDate: string | null
  originalAmountCents: number | null
  vat9GrossCents: number | null
  vat21GrossCents: number | null
}

export interface QuarterRevolutSummary {
  quarter: string
  transactionCount: number
  originalAmountCents: number
  vat9GrossCents: number
  vat9VatCents: number // 9% output VAT (owed)
  vat21GrossCents: number
  vat21VatCents: number // 21% output VAT (owed)
  unclassifiedCount: number
  unclassifiedAmountCents: number
}

export type RevolutSummaryTotals = Omit<QuarterRevolutSummary, 'quarter'> & {
  unpaidCount: number
  unpaidAmountCents: number
}

/**
 * Buckets Revolut settlement transactions by the quarter their money
 * actually left Revolut for the bank (payoutDate).
 *
 * `periodOf` defaults to quarterly bucketing but accepts any date->string
 * key (e.g. `monthFromDate`) so the BTW dashboard's per-month view reuses
 * this exact math instead of re-deriving it.
 */
export function aggregateRevolutSummary(
  transactions: RevolutTransactionSummaryInput[],
  periodOf: (date: string) => string = quarterFromDate
): { quarters: QuarterRevolutSummary[]; totals: RevolutSummaryTotals } {
  const byQuarter = new Map<string, QuarterRevolutSummary>()
  let unpaidCount = 0
  let unpaidAmountCents = 0

  for (const t of transactions) {
    if (!t.payoutDate) {
      unpaidCount += 1
      unpaidAmountCents += t.originalAmountCents ?? 0
      continue
    }
    const quarter = periodOf(t.payoutDate)
    const original = t.originalAmountCents ?? 0
    const isClassified = t.vat9GrossCents != null || t.vat21GrossCents != null
    const vat9Gross = t.vat9GrossCents ?? 0
    const vat21Gross = t.vat21GrossCents ?? 0
    const vat9 = splitVat(vat9Gross, 9)
    const vat21 = splitVat(vat21Gross, 21)

    const agg = byQuarter.get(quarter) ?? {
      quarter, transactionCount: 0, originalAmountCents: 0,
      vat9GrossCents: 0, vat9VatCents: 0, vat21GrossCents: 0, vat21VatCents: 0,
      unclassifiedCount: 0, unclassifiedAmountCents: 0,
    }
    agg.transactionCount += 1
    agg.originalAmountCents += original
    agg.vat9GrossCents += vat9Gross
    agg.vat9VatCents += vat9.vatCents
    agg.vat21GrossCents += vat21Gross
    agg.vat21VatCents += vat21.vatCents
    if (!isClassified) {
      agg.unclassifiedCount += 1
      agg.unclassifiedAmountCents += original
    }
    byQuarter.set(quarter, agg)
  }

  const quarters = [...byQuarter.values()].sort((a, b) => b.quarter.localeCompare(a.quarter))

  const totals = quarters.reduce<RevolutSummaryTotals>(
    (acc, q) => ({
      transactionCount: acc.transactionCount + q.transactionCount,
      originalAmountCents: acc.originalAmountCents + q.originalAmountCents,
      vat9GrossCents: acc.vat9GrossCents + q.vat9GrossCents,
      vat9VatCents: acc.vat9VatCents + q.vat9VatCents,
      vat21GrossCents: acc.vat21GrossCents + q.vat21GrossCents,
      vat21VatCents: acc.vat21VatCents + q.vat21VatCents,
      unclassifiedCount: acc.unclassifiedCount + q.unclassifiedCount,
      unclassifiedAmountCents: acc.unclassifiedAmountCents + q.unclassifiedAmountCents,
      unpaidCount, unpaidAmountCents,
    }),
    {
      transactionCount: 0, originalAmountCents: 0, vat9GrossCents: 0, vat9VatCents: 0,
      vat21GrossCents: 0, vat21VatCents: 0, unclassifiedCount: 0, unclassifiedAmountCents: 0,
      unpaidCount, unpaidAmountCents,
    }
  )

  return { quarters, totals }
}
