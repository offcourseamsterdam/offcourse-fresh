import { quarterFromDate } from '@/lib/quarters'

export interface StripeBookingRow {
  created_at: string | null
  stripe_amount: number | null
  base_vat_amount_cents: number | null
  extras_vat_amount_cents: number | null
  total_vat_amount_cents: number | null
  stripe_fee_cents: number | null
}

export interface QuarterVatSummary {
  quarter: string
  bookingCount: number
  grossCents: number
  vat9Cents: number
  vat21Cents: number
  totalVatCents: number
  stripeFeeCents: number
  netCents: number
  missingFeeCount: number
}

export type VatSummaryTotals = Omit<QuarterVatSummary, 'quarter'>

/**
 * Buckets Stripe-paid bookings by the quarter payment happened (created_at,
 * not booking_date — a BTW aangifte is filed for when money changed hands,
 * not when the cruise is) and sums the VAT/fee fields already stored on each
 * booking row. Callers must pre-filter to `stripe_payment_intent_id is not
 * null` — reseller (GetYourGuide/Viator/TripAdvisor) and complimentary
 * bookings never have one, so they'd otherwise pollute "gross Stripe revenue"
 * with money that never touched Stripe.
 *
 * `periodOf` defaults to quarterly bucketing but accepts any date->string key
 * (e.g. `monthFromDate`) so the BTW dashboard's per-month view reuses this
 * exact math instead of re-deriving it — one VAT calculation, two grains.
 */
export function aggregateVatStripeSummary(
  bookings: StripeBookingRow[],
  periodOf: (date: string) => string = quarterFromDate
): { quarters: QuarterVatSummary[]; totals: VatSummaryTotals } {
  const byQuarter: Record<string, Omit<QuarterVatSummary, 'netCents'>> = {}

  for (const b of bookings) {
    if (!b.created_at) continue
    const quarter = periodOf(b.created_at)
    const agg = byQuarter[quarter] ?? (byQuarter[quarter] = {
      quarter, bookingCount: 0, grossCents: 0, vat9Cents: 0, vat21Cents: 0,
      totalVatCents: 0, stripeFeeCents: 0, missingFeeCount: 0,
    })
    agg.bookingCount += 1
    agg.grossCents += Number(b.stripe_amount ?? 0)
    agg.vat9Cents += Number(b.base_vat_amount_cents ?? 0)
    agg.vat21Cents += Number(b.extras_vat_amount_cents ?? 0)
    agg.totalVatCents += Number(b.total_vat_amount_cents ?? 0)
    if (b.stripe_fee_cents == null) {
      agg.missingFeeCount += 1
    } else {
      agg.stripeFeeCents += b.stripe_fee_cents
    }
  }

  const quarters = Object.values(byQuarter)
    .map(q => ({ ...q, netCents: q.grossCents - q.stripeFeeCents }))
    .sort((a, b) => (a.quarter > b.quarter ? -1 : 1))

  const totals = quarters.reduce<VatSummaryTotals>((acc, q) => ({
    bookingCount: acc.bookingCount + q.bookingCount,
    grossCents: acc.grossCents + q.grossCents,
    vat9Cents: acc.vat9Cents + q.vat9Cents,
    vat21Cents: acc.vat21Cents + q.vat21Cents,
    totalVatCents: acc.totalVatCents + q.totalVatCents,
    stripeFeeCents: acc.stripeFeeCents + q.stripeFeeCents,
    netCents: acc.netCents + q.netCents,
    missingFeeCount: acc.missingFeeCount + q.missingFeeCount,
  }), { bookingCount: 0, grossCents: 0, vat9Cents: 0, vat21Cents: 0, totalVatCents: 0, stripeFeeCents: 0, netCents: 0, missingFeeCount: 0 })

  return { quarters, totals }
}
