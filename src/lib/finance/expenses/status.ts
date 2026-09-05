/**
 * The Expense Record status machine (plan §4.3, PRD §13). Pure and total:
 * every combination of inputs maps to exactly one status, in a fixed order
 * of precedence, so the tests can enumerate it and the UI never shows two
 * things at once.
 *
 * Precedence, top wins:
 *   booked > sent_to_snelstart > ignored > needs_review > (payment/document combos)
 *
 * The "payment/document combos" are the PRD's situations A–D:
 *   payment, no cost document            → waiting_for_invoice   (A)
 *   payment + only an order confirmation → partially_matched     (the order is proven, the cost isn't)
 *   cost document, no payment            → waiting_for_payment   (C; B-with-receipt-only lands here too until the card payment syncs)
 *   both, score ≥ 0.90                   → matched → ready_for_snelstart once VAT is resolved without conflict
 *   both, score 0.60–0.89 (or unscored)  → partially_matched     (one click to confirm)
 */

export const EXPENSE_STATUSES = ['ignored', 'waiting_for_invoice', 'waiting_for_payment', 'partially_matched', 'matched', 'needs_review', 'ready_for_snelstart', 'sent_to_snelstart', 'booked'] as const
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number]

export const EXPENSE_STATUS_LABELS: Record<ExpenseStatus, string> = {
  ignored: 'Genegeerd',
  waiting_for_invoice: 'Wacht op factuur',
  waiting_for_payment: 'Wacht op betaling',
  partially_matched: 'Deels gekoppeld',
  matched: 'Gekoppeld',
  needs_review: 'Controle nodig',
  ready_for_snelstart: 'Klaar voor SnelStart',
  sent_to_snelstart: 'Naar SnelStart gestuurd',
  booked: 'Geboekt',
}

/** Auto-match at or above this; below AUTO and at or above PARTIAL is a "confirm with one click" match. */
export const MATCH_AUTO_THRESHOLD = 0.9
export const MATCH_PARTIAL_THRESHOLD = 0.6

export interface StatusInputs {
  /** A structural rule (internal transfer, bank fee) or Beer decided no document will ever exist. */
  ignored: boolean
  hasPayment: boolean
  /** An invoice PDF, receipt (image or Revolut), or a fetched invoice link — something with a cost breakdown. */
  hasCostDocument: boolean
  /** Only an order confirmation / notification mail — proves the order, not the amounts. */
  hasOrderConfirmationOnly: boolean
  /** 0..1 from expenses/match.ts, or 1 when Beer linked the document by hand; null when never scored. */
  matchConfidence: number | null
  /** vat_source is set (any source, including a 0% reverse-charge answer). */
  vatResolved: boolean
  vatConflict: boolean
  /** Duplicate suspicion, a near-tie between two candidates, or Beer flagged it. */
  flaggedForReview: boolean
  /**
   * Whether the cost document can go to the bookkeeper without a human look:
   * it came from Revolut (Beer attached it in the app), Beer linked/confirmed it
   * by hand, or a second independent VAT source agrees with it. An unknown
   * sender's PDF that merely scores well is NOT trusted — it parks at `matched`
   * (one click) instead of `ready_for_snelstart` (autopilot). Review finding
   * 2026-09-05: LLM-read mail content must never drive an outbound send alone.
   */
  provenanceTrusted: boolean
  sentToSnelstartAt: string | null
  bookedAt: string | null
}

export function deriveStatus(i: StatusInputs): ExpenseStatus {
  if (i.bookedAt) return 'booked'
  if (i.sentToSnelstartAt) return 'sent_to_snelstart'
  if (i.ignored) return 'ignored'
  if (i.vatConflict || i.flaggedForReview) return 'needs_review'

  if (!i.hasPayment) {
    // Nothing paid yet. Whatever we hold is a promise of a cost, not a cost.
    return 'waiting_for_payment'
  }
  if (!i.hasCostDocument) {
    return i.hasOrderConfirmationOnly ? 'partially_matched' : 'waiting_for_invoice'
  }

  const score = i.matchConfidence ?? 0
  if (score < MATCH_AUTO_THRESHOLD) return 'partially_matched'
  return i.vatResolved && i.provenanceTrusted ? 'ready_for_snelstart' : 'matched'
}

/** Statuses that still need something — the ones a KPI counts as "open". */
export const OPEN_STATUSES: ExpenseStatus[] = ['waiting_for_invoice', 'waiting_for_payment', 'partially_matched', 'matched', 'needs_review', 'ready_for_snelstart']

/** Statuses where a document may go out to SnelStart automatically. Deliberately only one. */
export const AUTO_FORWARD_STATUSES: ExpenseStatus[] = ['ready_for_snelstart']
