import { quarterFromDate } from '@/lib/quarters'

// FareHarbor's own payment processing — historical/archief, ended when the
// site migrated to its native Stripe checkout in early May 2026. FareHarbor
// already computes the 9%/21% VAT split per line (BTW Laag/BTW Hoog), so
// there's nothing to derive here, unlike Revolut. Both rates are OWED
// (verschuldigd) — FareHarbor was Off Course's own payment processor for
// these bookings, not a marketplace taking a commission, so there's no
// deductible bucket the way BoatLocal/Withlocals/Barqo have one.
//
// Bucketing uses `bankPayoutDate` — the date verified against the real bank
// ledger — NOT FareHarbor's own reported payout date, which turned out to
// be unreliable (one payout showed FareHarbor's date as 2025-06-29 but the
// bank transfer landed 2025-07-01; 42 separate FareHarbor payouts all
// landed in the bank together as a single consolidated transfer). Without
// the real bank date, a payout can't be traced back to an actual bank
// transaction — useless for the accountant. Unconfirmed payouts (no
// bankPayoutDate yet) are tracked separately, never silently dropped or
// bucketed by guesswork.

export interface FareHarborPayoutSummaryInput {
  bankPayoutDate: string | null
  grossCents: number | null
  netCents: number | null
  vat9Cents: number | null
  vat21Cents: number | null
}

export interface QuarterFareHarborPayoutSummary {
  quarter: string
  payoutCount: number
  grossCents: number
  netCents: number
  vat9Cents: number
  vat21Cents: number
}

export type FareHarborPayoutSummaryTotals = Omit<QuarterFareHarborPayoutSummary, 'quarter'> & {
  unconfirmedCount: number
  unconfirmedNetCents: number
}

/**
 * Buckets FareHarbor payouts by the quarter their money actually landed in
 * the bank (bankPayoutDate — verified against the ledger, not FareHarbor's
 * own reported date).
 *
 * `periodOf` defaults to quarterly bucketing but accepts any date->string
 * key (e.g. `monthFromDate`) so the BTW dashboard's per-month view reuses
 * this exact math instead of re-deriving it.
 */
export function aggregateFareHarborPayoutSummary(
  payouts: FareHarborPayoutSummaryInput[],
  periodOf: (date: string) => string = quarterFromDate
): { quarters: QuarterFareHarborPayoutSummary[]; totals: FareHarborPayoutSummaryTotals } {
  const byQuarter = new Map<string, QuarterFareHarborPayoutSummary>()
  let unconfirmedCount = 0
  let unconfirmedNetCents = 0

  for (const p of payouts) {
    if (!p.bankPayoutDate) {
      unconfirmedCount += 1
      unconfirmedNetCents += p.netCents ?? 0
      continue
    }
    const quarter = periodOf(p.bankPayoutDate)
    const agg = byQuarter.get(quarter) ?? {
      quarter, payoutCount: 0, grossCents: 0, netCents: 0, vat9Cents: 0, vat21Cents: 0,
    }
    agg.payoutCount += 1
    agg.grossCents += p.grossCents ?? 0
    agg.netCents += p.netCents ?? 0
    agg.vat9Cents += p.vat9Cents ?? 0
    agg.vat21Cents += p.vat21Cents ?? 0
    byQuarter.set(quarter, agg)
  }

  const quarters = [...byQuarter.values()].sort((a, b) => b.quarter.localeCompare(a.quarter))

  const totals = quarters.reduce<FareHarborPayoutSummaryTotals>(
    (acc, q) => ({
      payoutCount: acc.payoutCount + q.payoutCount,
      grossCents: acc.grossCents + q.grossCents,
      netCents: acc.netCents + q.netCents,
      vat9Cents: acc.vat9Cents + q.vat9Cents,
      vat21Cents: acc.vat21Cents + q.vat21Cents,
      unconfirmedCount, unconfirmedNetCents,
    }),
    { payoutCount: 0, grossCents: 0, netCents: 0, vat9Cents: 0, vat21Cents: 0, unconfirmedCount, unconfirmedNetCents }
  )

  return { quarters, totals }
}
