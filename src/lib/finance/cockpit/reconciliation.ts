/**
 * Bank-side reconciliation (plan §7, PRD §38: "never hide mismatches").
 *
 * Revolut computes a running balance on every transaction leg
 * (`balance_after_cents`, already written by sync.ts's mapTransaction). The
 * cheapest, least error-prone way to check our copy of the ledger against
 * reality is to compare the freshest account balance we just fetched against
 * the balance Revolut itself stamped on the most recent completed
 * transaction we know about — if those two numbers disagree, something
 * happened on the account that our sync hasn't accounted for (a transaction
 * type we don't map, a manual adjustment, a missed page), and that gap must
 * never be silently folded into "vrij" cash.
 *
 * Deliberately NOT computed by summing our own transaction deltas: that
 * would just be re-deriving a number Revolut already handed us, and any bug
 * in our summing logic would produce a false gap instead of a real check.
 *
 * Pure.
 */

export interface ReconciliationCheck {
  /** balanceCents − lastKnownBalanceCents. Zero when there's nothing to reconcile against yet. */
  gapCents: number
  /** What the last completed transaction's own balance said — null when we have no completed transaction at all (a brand new connection). */
  expectedCents: number | null
}

export function checkReconciliation(balanceCents: number, lastKnownBalanceCents: number | null): ReconciliationCheck {
  if (lastKnownBalanceCents == null) return { gapCents: 0, expectedCents: null }
  return { gapCents: balanceCents - lastKnownBalanceCents, expectedCents: lastKnownBalanceCents }
}
