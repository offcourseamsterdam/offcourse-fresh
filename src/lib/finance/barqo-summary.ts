import { quarterFromDate } from '@/lib/quarters'
import { splitVat } from '@/lib/finance/withlocals-summary'

// Barqo turns out to have the same gross/net commission shape as BoatLocal,
// not a single undifferentiated price. Cross-referencing Beer's own bank
// ledger found a real payout of €249.00 against a €300.00 gross booking —
// the €51.00 gap is Barqo's own commission, itself carrying 21% VAT (kept as
// deductible input VAT, same convention as BoatLocal/Withlocals). The 9%
// output VAT is derived from the NET payout, matching Click & Boat/
// GetYourGuide/Viator/GetMyBoat's net-basis rule — NOT the gross price.
//
// netPayoutCents is nullable: it's only confirmed once a booking's real
// payout has been found in a bank statement. Until then this falls back to
// treating the gross price as its own net (no commission split) — the old
// behaviour, so an unconfirmed booking's VAT figure doesn't silently change
// based on a guess.

export interface BarqoBookingSummaryInput {
  tripDate: string | null
  priceCents: number | null // gross tour price shown on the Barqo dashboard
  netPayoutCents: number | null // actual bank payout — the VAT base. Null until confirmed.
  revenueVatRate: number | null
}

export interface QuarterBarqoSummary {
  quarter: string
  bookingCount: number
  priceCents: number // gross total
  netPayoutCents: number // net total (falls back to gross for unconfirmed bookings)
  revenueExCents: number
  revenueVatCents: number // 9% output VAT (owed) — over the net payout
  commissionExCents: number
  commissionVatCents: number // 21% input VAT on Barqo's commission (deductible)
}

export type BarqoSummaryTotals = Omit<QuarterBarqoSummary, 'quarter'>

const DEFAULT_REVENUE_VAT_RATE = 9
const COMMISSION_VAT_RATE = 21

/**
 * Buckets Barqo bookings by the quarter the trip happened (trip_date).
 *
 * `periodOf` defaults to quarterly bucketing but accepts any date->string
 * key (e.g. `monthFromDate`) so the BTW dashboard's per-month view reuses
 * this exact math instead of re-deriving it.
 */
export function aggregateBarqoSummary(
  bookings: BarqoBookingSummaryInput[],
  periodOf: (date: string) => string = quarterFromDate
): { quarters: QuarterBarqoSummary[]; totals: BarqoSummaryTotals } {
  const byQuarter = new Map<string, QuarterBarqoSummary>()

  for (const b of bookings) {
    if (!b.tripDate) continue
    const quarter = periodOf(b.tripDate)
    const gross = b.priceCents ?? 0
    const net = b.netPayoutCents ?? gross
    const rate = b.revenueVatRate ?? DEFAULT_REVENUE_VAT_RATE
    const { exCents, vatCents } = splitVat(net, rate)
    const commissionInclVat = Math.max(gross - net, 0)
    const commission = splitVat(commissionInclVat, COMMISSION_VAT_RATE)

    const agg = byQuarter.get(quarter) ?? {
      quarter, bookingCount: 0, priceCents: 0, netPayoutCents: 0,
      revenueExCents: 0, revenueVatCents: 0, commissionExCents: 0, commissionVatCents: 0,
    }
    agg.bookingCount += 1
    agg.priceCents += gross
    agg.netPayoutCents += net
    agg.revenueExCents += exCents
    agg.revenueVatCents += vatCents
    agg.commissionExCents += commission.exCents
    agg.commissionVatCents += commission.vatCents
    byQuarter.set(quarter, agg)
  }

  const quarters = [...byQuarter.values()].sort((a, b) => b.quarter.localeCompare(a.quarter))

  const totals = quarters.reduce<BarqoSummaryTotals>(
    (acc, q) => ({
      bookingCount: acc.bookingCount + q.bookingCount,
      priceCents: acc.priceCents + q.priceCents,
      netPayoutCents: acc.netPayoutCents + q.netPayoutCents,
      revenueExCents: acc.revenueExCents + q.revenueExCents,
      revenueVatCents: acc.revenueVatCents + q.revenueVatCents,
      commissionExCents: acc.commissionExCents + q.commissionExCents,
      commissionVatCents: acc.commissionVatCents + q.commissionVatCents,
    }),
    { bookingCount: 0, priceCents: 0, netPayoutCents: 0, revenueExCents: 0, revenueVatCents: 0, commissionExCents: 0, commissionVatCents: 0 }
  )

  return { quarters, totals }
}
