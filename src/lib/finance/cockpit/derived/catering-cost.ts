/**
 * Estimating what catering actually costs, from what it sells for.
 *
 * There is no purchase invoice data yet (the Finance Inbox that will bring
 * that in is Phase 4, and `extras.cost_price_value` was deliberately dropped
 * in Phase 0 along with the Profit-First experiment it belonged to). What we
 * do know, from Beer directly: every catering sell price is the cost plus a
 * fixed 30% markup. That is enough for an honest estimate — clearly labelled
 * as one — rather than waiting for real invoices to say anything at all.
 *
 * sell = cost × (1 + markup)  ⇒  cost = sell ÷ (1 + markup)
 *
 * This never writes a fact anywhere. It estimates a spend for a period so it
 * can show up as an insight ("~€X aan cateringinkoop deze maand, geschat") —
 * never as a stored obligation or a transaction classification, both of which
 * would claim more certainty than a markup assumption can support. The moment
 * real purchase invoices exist (Phase 4), they replace this estimate outright.
 *
 * Pure.
 */

export const DEFAULT_CATERING_MARKUP_PCT = 30

/** Extras categories that are catering/onboard consumables, not merchandise or fees. */
export const CATERING_EXTRA_CATEGORIES = ['food', 'drinks'] as const

export interface CateringExtra {
  id: string
  name: string
  category: string
  /** Sell price in cents, per the extras catalogue. */
  priceValueCents: number
}

export interface CateringSaleLine {
  extraId: string
  quantity: number
  /** Date the cruise/sale happened, 'YYYY-MM-DD'. */
  date: string
}

export interface CateringCostEstimate {
  extraId: string
  name: string
  sellPriceCents: number
  estimatedCostCents: number
  estimatedMarginCents: number
}

export function isCateringExtra(category: string): boolean {
  return (CATERING_EXTRA_CATEGORIES as readonly string[]).includes(category)
}

/** cost = sell ÷ (1 + markup%). Rounded to the cent; never negative. */
export function estimateCostFromSellPrice(sellPriceCents: number, markupPct: number = DEFAULT_CATERING_MARKUP_PCT): number {
  if (sellPriceCents <= 0) return 0
  return Math.max(0, Math.round(sellPriceCents / (1 + markupPct / 100)))
}

export function estimateExtraCost(extra: CateringExtra, markupPct: number = DEFAULT_CATERING_MARKUP_PCT): CateringCostEstimate {
  const cost = estimateCostFromSellPrice(extra.priceValueCents, markupPct)
  return {
    extraId: extra.id,
    name: extra.name,
    sellPriceCents: extra.priceValueCents,
    estimatedCostCents: cost,
    estimatedMarginCents: extra.priceValueCents - cost,
  }
}

export interface CateringPeriodEstimate {
  periodStart: string
  periodEnd: string
  /** Sum of quantity × estimated cost, across every sale line in the period. */
  estimatedCostCents: number
  estimatedSellCents: number
  lineCount: number
  /** Extras sold that are not in the catalogue any more, so their cost could not be estimated. */
  unknownExtraIds: string[]
}

export function estimateCateringSpend(
  extras: CateringExtra[],
  sales: CateringSaleLine[],
  opts: { from: string; to: string; markupPct?: number },
): CateringPeriodEstimate {
  const byId = new Map(extras.filter(e => isCateringExtra(e.category)).map(e => [e.id, e]))
  const unknown = new Set<string>()
  let cost = 0
  let sell = 0
  let lineCount = 0

  for (const line of sales) {
    if (line.date < opts.from || line.date > opts.to) continue
    const extra = byId.get(line.extraId)
    if (!extra) { unknown.add(line.extraId); continue }
    const estimate = estimateExtraCost(extra, opts.markupPct)
    cost += estimate.estimatedCostCents * line.quantity
    sell += extra.priceValueCents * line.quantity
    lineCount++
  }

  return {
    periodStart: opts.from,
    periodEnd: opts.to,
    estimatedCostCents: cost,
    estimatedSellCents: sell,
    lineCount,
    unknownExtraIds: [...unknown].sort(),
  }
}
