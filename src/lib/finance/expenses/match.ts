/**
 * Which payment does this document belong to? (plan §4.1, PRD §6)
 *
 * Several weak-to-strong signals add up to one score; no single field decides.
 * A card payment of exactly €121 at "BOL.COM" three days before an invoice from
 * "bol.com b.v." for €121 is a match. The same €121 to a different merchant is
 * not, however tempting the amount. Two equally good candidates are a question
 * for Beer, never a coin flip.
 *
 * Pure: documents and expenses in, ranked scores and a decision out. The
 * orchestrator (match-orchestrator.ts) loads candidates and writes results.
 */
import type { DocumentFields } from './extract-document'
import { amountsClose, daysFromTo, nameSimilarity, normalizeReference, referenceContains } from './normalize'
import { MATCH_AUTO_THRESHOLD, MATCH_PARTIAL_THRESHOLD } from './status'

export type MatchDocumentKind = 'invoice_pdf' | 'receipt_image' | 'revolut_receipt' | 'invoice_link' | 'order_confirmation_email' | 'invoice_notification_email' | 'payment_confirmation_email' | 'other_email'

export interface MatchDocument {
  id: string
  kind: MatchDocumentKind
  extracted: Partial<DocumentFields>
  /** When the document arrived — the fallback date when it states none. */
  createdAt: string
}

export interface MatchExpense {
  id: string
  cashOutCents: number | null
  paidAt: string | null
  supplierName: string | null
  /** Bank reference + description, as Revolut gave them. */
  bankReference: string | null
  bankDescription: string | null
  counterpartyIban: string | null
  currency: string | null
}

export interface MatchSignals {
  exactAmount: boolean
  amountWithin: boolean
  /** 0..1 name similarity, already weighted into the score. */
  supplierName: number
  dateProximity: boolean
  numberInReference: boolean
  ibanMatch: boolean
  currencyOk: boolean
}

export interface MatchScore {
  score: number
  signals: MatchSignals
}

/** Weights (plan §4.1, tuned so exact amount + same merchant + plausible date = auto, and any weaker combination needs one more signal or one click). */
export const WEIGHTS = {
  exactAmount: 0.45,
  amountWithin: 0.25,
  supplierName: 0.3,
  dateProximity: 0.15,
  numberInReference: 0.15,
  ibanMatch: 0.15,
} as const

/** Two candidates this close are a question, not an answer. */
export const NEAR_TIE_DELTA = 0.05

const COST_KINDS = new Set<MatchDocumentKind>(['invoice_pdf', 'receipt_image', 'revolut_receipt', 'invoice_link'])

/**
 * Plausible distance between the document's date and the payment date, in
 * days, relative to the payment: an invoice is issued up to 2 days before a
 * card payment or up to 14 days after it (webshops invoice on shipping); an
 * order confirmation lands from 3 days before to 1 day after the payment.
 */
function dateWindow(kind: MatchDocumentKind): { before: number; after: number } {
  return COST_KINDS.has(kind) ? { before: 2, after: 14 } : { before: 3, after: 1 }
}

export function scoreMatch(doc: MatchDocument, expense: MatchExpense): MatchScore {
  const e = doc.extracted
  const signals: MatchSignals = { exactAmount: false, amountWithin: false, supplierName: 0, dateProximity: false, numberInReference: false, ibanMatch: false, currencyOk: true }

  if (e.currency && expense.currency && e.currency.toUpperCase() !== expense.currency.toUpperCase()) {
    signals.currencyOk = false
    return { score: 0, signals }
  }

  let score = 0

  if (e.grossCents != null && expense.cashOutCents != null) {
    const a = amountsClose(e.grossCents, expense.cashOutCents)
    if (a.exact) { signals.exactAmount = true; score += WEIGHTS.exactAmount }
    else if (a.within) { signals.amountWithin = true; score += WEIGHTS.amountWithin }
  }

  const sim = nameSimilarity(e.supplierName, expense.supplierName)
  signals.supplierName = sim
  score += WEIGHTS.supplierName * sim

  const docDate = e.invoiceDate ?? doc.createdAt
  if (docDate && expense.paidAt) {
    const delta = daysFromTo(expense.paidAt, docDate) // + = document after payment
    const w = dateWindow(doc.kind)
    if (delta >= -w.before && delta <= w.after) { signals.dateProximity = true; score += WEIGHTS.dateProximity }
  }

  const haystack = `${expense.bankReference ?? ''} ${expense.bankDescription ?? ''}`
  if (referenceContains(haystack, e.orderNumber) || referenceContains(haystack, e.invoiceNumber) || referenceContains(haystack, e.paymentReference)) {
    signals.numberInReference = true
    score += WEIGHTS.numberInReference
  }

  if (e.iban && expense.counterpartyIban && normalizeReference(e.iban) === normalizeReference(expense.counterpartyIban)) {
    signals.ibanMatch = true
    score += WEIGHTS.ibanMatch
  }

  return { score: Math.min(1, Math.round(score * 1000) / 1000), signals }
}

export interface RankedCandidate<T extends MatchExpense = MatchExpense> {
  expense: T
  match: MatchScore
}

export function rankCandidates<T extends MatchExpense>(doc: MatchDocument, expenses: T[]): RankedCandidate<T>[] {
  return expenses
    .map(expense => ({ expense, match: scoreMatch(doc, expense) }))
    .filter(c => c.match.score > 0)
    .sort((a, b) => b.match.score - a.match.score || Math.abs(daysFromTo(a.expense.paidAt ?? '', doc.createdAt)) - Math.abs(daysFromTo(b.expense.paidAt ?? '', doc.createdAt)))
}

export type MatchDecision<T extends MatchExpense = MatchExpense> =
  | { kind: 'auto'; best: RankedCandidate<T> }
  | { kind: 'partial'; best: RankedCandidate<T> }
  | { kind: 'review'; best: RankedCandidate<T>; runnerUp: RankedCandidate<T>; reason: string }
  | { kind: 'none' }

/**
 * ≥ 0.90 and clearly ahead → auto. ≥ 0.90 but a runner-up within NEAR_TIE_DELTA
 * → review (two payments look the same; Beer picks). 0.60–0.89 → partial (one
 * click). Below → none: the document stays an orphan and is retried as new
 * payments arrive.
 */
export function decideMatch<T extends MatchExpense>(ranked: RankedCandidate<T>[]): MatchDecision<T> {
  const [best, runnerUp] = ranked
  if (!best) return { kind: 'none' }
  if (best.match.score >= MATCH_AUTO_THRESHOLD) {
    if (runnerUp && best.match.score - runnerUp.match.score < NEAR_TIE_DELTA) {
      return { kind: 'review', best, runnerUp, reason: 'Twee betalingen lijken evenveel op dit document — kies zelf welke erbij hoort.' }
    }
    return { kind: 'auto', best }
  }
  if (best.match.score >= MATCH_PARTIAL_THRESHOLD) return { kind: 'partial', best }
  return { kind: 'none' }
}
