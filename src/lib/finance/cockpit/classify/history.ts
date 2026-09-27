/**
 * Classification by precedent: "you filed this counterparty the same way the
 * last N times, so here it is again."
 *
 * Sits between the learned rules and the AI (see apply.ts). Beer's own past
 * decisions are the most reliable signal there is — in the live data, 22 of
 * the 23 counterparties he classified more than once always got exactly the
 * same category and subcategory. A learned rule needs Beer to write a
 * pattern; this needs nothing but the decisions he already made.
 *
 * Deliberately strict, because it applies without asking:
 *   - only Beer's own decisions count (classified_by = 'user'), never an
 *     earlier rule or AI verdict — otherwise one wrong guess would copy
 *     itself forward forever;
 *   - at least MIN_PRECEDENTS of them, for the same counterparty and the same
 *     direction of money, and every one must agree on category, subcategory
 *     and boat;
 *   - never copies a link to a goal, obligation or loan payment — those are
 *     specific commitments (this month's loan instalment, one savings goal)
 *     that a pattern can't prove, same rule as learned rules (rules.ts);
 *   - the amount must look like the ones before it; a €2,000 charge from a
 *     supplier that is normally €40 goes to the AI and a human instead.
 * Anything short of that still helps: the matching precedents are handed to
 * the AI as its first examples (examplesFor).
 */

import { directionAllows, isCategory, type Category } from './taxonomy'
import type { ClassifiableTransaction, Classification } from './rules'

export const MIN_PRECEDENTS = 2
/** How far outside the previous amounts a new one may fall and still count as "the usual". */
const AMOUNT_TOLERANCE = 3

export interface PastClassification {
  /** From historyKey() of the past transaction. */
  key: string | null
  amountCents: number
  category: string
  subcategory: string | null
  boatId: string | null
  goalId: string | null
  obligationId: string | null
  loanPaymentId: string | null
  /** What the bank showed, for the AI's examples. */
  label: string
  /** When Beer classified it; newest first is the useful order for examples. */
  reviewedAt: string | null
}

function norm(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Who the money went to or came from, as a stable key. Revolut gives a
 * transfer's counterparty only as an id (never a name), and a card payment's
 * merchant by name; everything else (top-ups, charges) only has a description.
 */
export function historyKey(tx: Pick<ClassifiableTransaction, 'counterpartyId' | 'merchantName' | 'description'>): string | null {
  if (tx.counterpartyId) return `cp:${tx.counterpartyId}`
  if (tx.merchantName) return `m:${norm(tx.merchantName)}`
  const d = norm(tx.description)
  return d ? `d:${d}` : null
}

const sameDirection = (a: number, b: number) => (a < 0) === (b < 0)

/** Beer's past decisions for this counterparty and direction, newest first. */
export function precedentsFor(tx: ClassifiableTransaction, past: PastClassification[]): PastClassification[] {
  const key = historyKey(tx)
  if (!key) return []
  return past
    .filter(p => p.key === key && sameDirection(p.amountCents, tx.amountCents))
    .sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? ''))
}

export function classifyByHistory(tx: ClassifiableTransaction, past: PastClassification[]): Classification | null {
  const precedents = precedentsFor(tx, past)
  if (precedents.length < MIN_PRECEDENTS) return null

  const first = precedents[0]
  const agree = precedents.every(
    p => p.category === first.category && (p.subcategory ?? null) === (first.subcategory ?? null) && (p.boatId ?? null) === (first.boatId ?? null),
  )
  if (!agree) return null
  if (precedents.some(p => p.goalId || p.obligationId || p.loanPaymentId)) return null
  if (!isCategory(first.category) || !directionAllows(first.category as Category, tx.amountCents)) return null

  const amounts = precedents.map(p => Math.abs(p.amountCents))
  const amount = Math.abs(tx.amountCents)
  if (amount > Math.max(...amounts) * AMOUNT_TOLERANCE || amount * AMOUNT_TOLERANCE < Math.min(...amounts)) return null

  return {
    category: first.category as Category,
    subcategory: first.subcategory,
    boatId: first.boatId,
    confidence: 1,
    reason: `Zoals je de vorige ${precedents.length} keer bij deze tegenpartij deed`,
    // The database only knows rule / ai / user; a precedent is a rule Beer
    // taught by example rather than by writing a pattern.
    source: 'rule',
  }
}

/**
 * Examples for the AI prompt: this counterparty's own precedents first (the
 * most telling examples by far), then Beer's most recent other decisions for
 * general style — instead of just "the last 20 corrections of anything".
 */
export function examplesFor(tx: ClassifiableTransaction, past: PastClassification[], limit = 20): PastClassification[] {
  const own = precedentsFor(tx, past).slice(0, 8)
  const ownSet = new Set(own)
  const recent = [...past]
    .filter(p => !ownSet.has(p))
    .sort((a, b) => (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? ''))
    .slice(0, Math.max(0, limit - own.length))
  return [...own, ...recent]
}
