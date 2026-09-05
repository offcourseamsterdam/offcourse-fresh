/**
 * VAT determination for an Expense Record (plan §4.2, PRD §8).
 *
 * Several sources can each claim a VAT figure for the same purchase: the
 * invoice, a receipt, the tax rate Beer picked on the expense in the Revolut
 * app, an AI guess, or a number Beer typed himself. This module picks one —
 * by trust, not by recency — and, when two present sources disagree, says so
 * instead of quietly taking the winner. A conflict parks the record in
 * needs_review; it is never resolved by this code.
 *
 * Pure.
 */

export type VatSource = 'invoice' | 'receipt' | 'revolut' | 'ai' | 'manual'

/** Most trusted first. `manual` = Beer typed it, which ends any argument. */
export const VAT_SOURCE_PRIORITY: VatSource[] = ['manual', 'invoice', 'receipt', 'revolut', 'ai']

export const VAT_SOURCE_LABELS: Record<VatSource, string> = {
  invoice: 'factuur',
  receipt: 'bon',
  revolut: 'Revolut',
  ai: 'AI-schatting',
  manual: 'handmatig',
}

/** Two figures within this many cents are "the same" — rounding, not a disagreement. */
export const VAT_CONFLICT_TOLERANCE_CENTS = 2

export interface VatCandidate {
  source: VatSource
  vatCents: number
  /** The rate the source stated, when it did (Revolut always gives one; an invoice usually). */
  ratePct?: number | null
}

export interface VatResolution {
  vatCents: number | null
  netCents: number | null
  ratePct: number | null
  source: VatSource | null
  /** source → vatCents for every candidate, only when at least two disagree beyond the tolerance. */
  conflict: Partial<Record<VatSource, number>> | null
}

/**
 * Revolut gives a rate per split, not an amount. VAT inside a gross figure:
 * gross × pct / (100 + pct). €121 at 21% → €21. Integer cents in and out.
 */
export function vatFromGrossAndRate(grossCents: number, ratePct: number): number {
  if (ratePct <= 0) return 0
  return Math.round((grossCents * ratePct) / (100 + ratePct))
}

/** The rate implied by a VAT amount on a gross figure, rounded to a whole percent — for display when a source gave no rate. */
export function impliedRatePct(grossCents: number | null, vatCents: number): number | null {
  if (grossCents == null || grossCents <= vatCents || vatCents < 0) return null
  const net = grossCents - vatCents
  return net > 0 ? Math.round((vatCents / net) * 100) : null
}

export function resolveVat(grossCents: number | null, candidates: VatCandidate[]): VatResolution {
  const present = candidates.filter(c => Number.isInteger(c.vatCents) && c.vatCents >= 0)
  if (present.length === 0) return { vatCents: null, netCents: null, ratePct: null, source: null, conflict: null }

  const chosen = [...present].sort((a, b) => VAT_SOURCE_PRIORITY.indexOf(a.source) - VAT_SOURCE_PRIORITY.indexOf(b.source))[0]

  // A manual figure ends any disagreement: Beer looked at the sources and decided.
  let conflict: VatResolution['conflict'] = null
  if (chosen.source !== 'manual') {
    const disagree = present.some(c => Math.abs(c.vatCents - chosen.vatCents) > VAT_CONFLICT_TOLERANCE_CENTS)
    if (disagree) {
      conflict = {}
      for (const c of present) conflict[c.source] = c.vatCents
    }
  }

  const netCents = grossCents != null ? grossCents - chosen.vatCents : null
  const ratePct = chosen.ratePct ?? impliedRatePct(grossCents, chosen.vatCents)

  return { vatCents: chosen.vatCents, netCents, ratePct, source: chosen.source, conflict }
}
