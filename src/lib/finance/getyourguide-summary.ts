import { quarterFromDate } from '@/lib/quarters'
import { splitVat } from '@/lib/finance/withlocals-summary'

export interface GetYourGuidePaymentSummaryInput {
  paymentRunDate: string | null
  amountCents: number | null
  revenueVatRate: number | null
}

export interface QuarterGetYourGuideSummary {
  quarter: string
  paymentCount: number
  totalAmountCents: number
  revenueExCents: number
  revenueVatCents: number // 9% output VAT (owed) — over the net payout, same convention as Click & Boat
}

export type GetYourGuideSummaryTotals = Omit<QuarterGetYourGuideSummary, 'quarter'>

const DEFAULT_REVENUE_VAT_RATE = 9

/**
 * Buckets GetYourGuide payments by the quarter they were actually paid out
 * (payment run date), same convention as the Viator and Stripe summaries.
 *
 * 9% output VAT is derived from the NET amount GetYourGuide actually pays
 * out (there's no gross customer price on the payment PDF at all — no
 * per-booking breakdown either) — Beer confirmed this net-payout basis for
 * GetYourGuide, reversing an earlier "international company, no 9%"
 * assumption. Same convention as Click & Boat, opposite of Withlocals
 * (gross tour price) — see the per-source VAT-base memory note before
 * assuming any of these generalize to each other.
 *
 * `periodOf` defaults to quarterly bucketing but accepts any date->string
 * key (e.g. `monthFromDate`) so the BTW dashboard's per-month view reuses
 * this exact math instead of re-deriving it.
 */
export function aggregateGetYourGuideSummary(
  payments: GetYourGuidePaymentSummaryInput[],
  periodOf: (date: string) => string = quarterFromDate
): { quarters: QuarterGetYourGuideSummary[]; totals: GetYourGuideSummaryTotals } {
  const byQuarter = new Map<string, QuarterGetYourGuideSummary>()

  for (const payment of payments) {
    if (!payment.paymentRunDate) continue
    const quarter = periodOf(payment.paymentRunDate)
    const net = payment.amountCents ?? 0
    const rate = payment.revenueVatRate ?? DEFAULT_REVENUE_VAT_RATE
    const { exCents, vatCents } = splitVat(net, rate)

    const existing = byQuarter.get(quarter) ?? {
      quarter, paymentCount: 0, totalAmountCents: 0, revenueExCents: 0, revenueVatCents: 0,
    }
    existing.paymentCount += 1
    existing.totalAmountCents += net
    existing.revenueExCents += exCents
    existing.revenueVatCents += vatCents
    byQuarter.set(quarter, existing)
  }

  const quarters = [...byQuarter.values()].sort((a, b) => b.quarter.localeCompare(a.quarter))

  const totals = quarters.reduce<GetYourGuideSummaryTotals>(
    (acc, q) => ({
      paymentCount: acc.paymentCount + q.paymentCount,
      totalAmountCents: acc.totalAmountCents + q.totalAmountCents,
      revenueExCents: acc.revenueExCents + q.revenueExCents,
      revenueVatCents: acc.revenueVatCents + q.revenueVatCents,
    }),
    { paymentCount: 0, totalAmountCents: 0, revenueExCents: 0, revenueVatCents: 0 }
  )

  return { quarters, totals }
}
