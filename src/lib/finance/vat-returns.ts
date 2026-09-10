/**
 * Pure formatting for a filed BTW-aangifte — turns the real numbers Beer types in from the
 * accountant's PDF into the same {title, notes} shape derived/vat.ts's auto-computed indication
 * would have produced, so the finance_obligations row it closes reads consistently whether it
 * came from the nightly estimate or a real filing.
 *
 * Kept separate from the API route so the string-building is unit-testable without a database.
 */

export interface FiledVatReturn {
  quarter: string
  filedDate: string
  /** Signed, same convention as the aangifte's own "5c Totaal": negative = refund, positive = owed. */
  netCents: number
  vat9OwedCents?: number | null
  vat21OwedCents?: number | null
  voorbelastingCents?: number | null
}

function eur(cents: number): string {
  return new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 }).format(Math.round(Math.abs(cents) / 100))
}

/** e.g. "BTW 2026-Q1 — aangifte binnen: €34.855 terugontvangen" */
export function vatReturnObligationTitle(input: FiledVatReturn): string {
  if (input.netCents < 0) return `BTW ${input.quarter} — aangifte binnen: €${eur(input.netCents)} terugontvangen`
  if (input.netCents > 0) return `BTW ${input.quarter} — aangifte binnen: €${eur(input.netCents)} verschuldigd`
  return `BTW ${input.quarter} — aangifte binnen: per saldo niets verschuldigd`
}

/**
 * The note left on the obligation it closes. `priorIndicationCents` (the auto-computed
 * estimate this filing replaces, if one existed) is called out explicitly when it disagrees
 * with reality by more than a euro — that gap is exactly what made "Komende verplichtingen"
 * wrong for 2026-Q1/Q2 (the estimate has no visibility into deductible VAT on real bank
 * expenses yet).
 */
export function vatReturnObligationNotes(input: FiledVatReturn, opts: { priorIndicationCents?: number | null; extraNotes?: string | null } = {}): string {
  const parts: string[] = [`Werkelijke aangifte, verzonden ${input.filedDate}.`]

  const breakdown: string[] = []
  if (input.vat9OwedCents) breakdown.push(`€${eur(input.vat9OwedCents)} verschuldigd laag (9%)`)
  if (input.vat21OwedCents) breakdown.push(`€${eur(input.vat21OwedCents)} verschuldigd hoog (21%)`)
  if (input.voorbelastingCents) breakdown.push(`€${eur(input.voorbelastingCents)} voorbelasting`)
  if (breakdown.length > 0) parts.push(breakdown.join(', ') + '.')

  if (opts.priorIndicationCents != null && Math.abs(opts.priorIndicationCents - input.netCents) > 100) {
    parts.push(`De eerder automatisch berekende indicatie was €${eur(opts.priorIndicationCents)} ${opts.priorIndicationCents < 0 ? 'terug' : 'verschuldigd'} — wijkt af van de werkelijke aangifte.`)
  }

  if (opts.extraNotes) parts.push(opts.extraNotes)

  return parts.join(' ')
}
