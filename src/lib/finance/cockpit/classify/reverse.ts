/**
 * Undoing what a transaction did to the plan.
 *
 * A transaction can be classified more than once: the AI guesses, Beer
 * corrects, a rule is added later. Each time, the effects of the previous
 * classification must be taken back before the new ones land, or the salary
 * buffer gets drawn down twice and a goal stays completed after its link is
 * removed.
 *
 * Pure. The stored `allocation_applied` array is the only thing needed to know
 * what to undo, so this never has to reason about history.
 */

import type { AllocationChange } from './allocation-effect'

export type ReverseOperation =
  | { kind: 'owner_salary_restore'; amountCents: number }
  | { kind: 'goal_restore'; goalId: string; amountCents: number }
  | { kind: 'goal_reopen'; goalId: string; restoreFundedCents: number }
  | { kind: 'obligation_reopen'; obligationId: string }
  | { kind: 'loan_payment_reopen'; loanPaymentId: string }

/**
 * The exact inverse of a set of applied changes. Reversed in the opposite
 * order they were applied, so a sequence that ends in a completion is undone
 * before the drawdown that preceded it.
 */
export function reverseChanges(applied: AllocationChange[] | null | undefined): ReverseOperation[] {
  if (!applied || applied.length === 0) return []
  const out: ReverseOperation[] = []
  for (const change of [...applied].reverse()) {
    switch (change.kind) {
      case 'owner_salary_drawdown':
        out.push({ kind: 'owner_salary_restore', amountCents: change.amountCents })
        break
      case 'goal_drawdown':
        out.push({ kind: 'goal_restore', goalId: change.goalId, amountCents: change.amountCents })
        break
      case 'goal_completed':
        // Completion released the reservation, so putting the goal back means
        // making it active again with the funding it had at that moment.
        out.push({ kind: 'goal_reopen', goalId: change.goalId, restoreFundedCents: change.releasedCents })
        break
      case 'obligation_paid':
        out.push({ kind: 'obligation_reopen', obligationId: change.obligationId })
        break
      case 'loan_payment_paid':
        out.push({ kind: 'loan_payment_reopen', loanPaymentId: change.loanPaymentId })
        break
    }
  }
  return out
}

/**
 * True when the new classification would produce exactly the same effects as
 * the ones already in force, so nothing has to be written at all.
 */
export function sameEffects(a: AllocationChange[] | null | undefined, b: AllocationChange[] | null | undefined): boolean {
  const left = a ?? []
  const right = b ?? []
  if (left.length !== right.length) return false
  return left.every((change, i) => stableKey(change) === stableKey(right[i]))
}

function stableKey(change: AllocationChange): string {
  switch (change.kind) {
    case 'owner_salary_drawdown': return `salary:${change.amountCents}`
    case 'goal_drawdown': return `goal:${change.goalId}:${change.amountCents}`
    case 'goal_completed': return `goal-done:${change.goalId}:${change.releasedCents}`
    case 'obligation_paid': return `obl:${change.obligationId}`
    case 'loan_payment_paid': return `loan:${change.loanPaymentId}`
  }
}
