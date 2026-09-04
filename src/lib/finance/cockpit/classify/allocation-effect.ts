/**
 * What a classified transaction does to the plan. Pure: current state in,
 * a list of intended changes out. The caller writes them (apply.ts).
 *
 * The rule that keeps the cockpit honest (plan §2, §7): cash has already
 * moved by itself, so a transaction never changes cash here. It only releases
 * the *reservation* that was standing against it. Concretely:
 *
 *   - an owner salary payment draws down the salary buffer
 *   - a purchase linked to a goal draws down (or completes) that goal
 *   - a payment linked to an obligation or loan period marks it paid
 *
 * Everything else has no planning effect at all. Booking revenue does not
 * increase any pot: it raises the bank balance, and the monthly allocation
 * cron decides later where that belongs (Phase 5).
 *
 * Nothing happens for a transaction that is not `completed`, because a pending
 * payment has not left the account yet and may still be declined or reverted.
 */

import type { Classification } from './rules'

export interface AllocationState {
  ownerSalaryCoverageCents: number
  goals: Array<{ id: string; name: string; targetCents: number; fundedCents: number; status: string }>
  obligations: Array<{ id: string; title: string; amountCents: number; status: string }>
  loanPayments: Array<{ id: string; loanName: string; dueDate: string; totalCents: number; isPaid: boolean }>
}

export type AllocationChange =
  | { kind: 'owner_salary_drawdown'; amountCents: number; newCoverageCents: number; reason: string }
  | { kind: 'goal_drawdown'; goalId: string; amountCents: number; newFundedCents: number; reason: string }
  | { kind: 'goal_completed'; goalId: string; releasedCents: number; overspendCents: number; reason: string }
  | { kind: 'obligation_paid'; obligationId: string; amountCents: number; reason: string }
  | { kind: 'loan_payment_paid'; loanPaymentId: string; amountCents: number; reason: string }

export interface EffectInput {
  amountCents: number
  state: string
  classification: Pick<Classification, 'category' | 'subcategory' | 'goalId' | 'obligationId' | 'loanPaymentId'>
  allocation: AllocationState
}

export function allocationEffects({ amountCents, state, classification, allocation }: EffectInput): AllocationChange[] {
  if (state !== 'completed') return []
  const changes: AllocationChange[] = []
  const spent = amountCents < 0 ? -amountCents : 0

  // 1. Owner salary: the buffer exists to cover exactly this payment.
  if (spent > 0 && classification.category === 'owner' && classification.subcategory === 'salary') {
    const drawn = Math.min(spent, allocation.ownerSalaryCoverageCents)
    if (drawn > 0) {
      changes.push({
        kind: 'owner_salary_drawdown',
        amountCents: drawn,
        newCoverageCents: allocation.ownerSalaryCoverageCents - drawn,
        // Paying more than was reserved is not an error; the buffer simply empties.
        reason: drawn < spent
          ? `Salaris uitbetaald; de dekking was €${eur(allocation.ownerSalaryCoverageCents)} en staat nu op €0`
          : 'Salaris uitbetaald, dekking navenant verlaagd',
      })
    }
  }

  // 2. A purchase made for a goal. Reaching the target completes it; the
  //    reservation is released rather than going negative (PRD §25).
  if (spent > 0 && classification.goalId) {
    const goal = allocation.goals.find(g => g.id === classification.goalId && g.status === 'active')
    if (goal) {
      const remainingTarget = Math.max(0, goal.targetCents - goal.fundedCents)
      if (spent >= remainingTarget && spent >= goal.fundedCents) {
        changes.push({
          kind: 'goal_completed',
          goalId: goal.id,
          releasedCents: goal.fundedCents,
          overspendCents: Math.max(0, spent - goal.targetCents),
          reason: spent > goal.targetCents
            ? `${goal.name} is uitgevoerd; €${eur(spent - goal.targetCents)} duurder dan het doel`
            : `${goal.name} is uitgevoerd`,
        })
      } else {
        const drawn = Math.min(spent, goal.fundedCents)
        changes.push({
          kind: 'goal_drawdown',
          goalId: goal.id,
          amountCents: drawn,
          newFundedCents: goal.fundedCents - drawn,
          reason: `Deeluitgave voor ${goal.name}`,
        })
      }
    }
  }

  // 3. Proven links to a dated commitment.
  if (spent > 0 && classification.obligationId) {
    const o = allocation.obligations.find(x => x.id === classification.obligationId && x.status === 'open')
    if (o) {
      changes.push({ kind: 'obligation_paid', obligationId: o.id, amountCents: o.amountCents, reason: `${o.title} betaald` })
    }
  }

  if (spent > 0 && classification.loanPaymentId) {
    const p = allocation.loanPayments.find(x => x.id === classification.loanPaymentId && !x.isPaid)
    if (p) {
      changes.push({ kind: 'loan_payment_paid', loanPaymentId: p.id, amountCents: p.totalCents, reason: `${p.loanName}, termijn ${p.dueDate} betaald` })
    }
  }

  return changes
}

function eur(cents: number): string {
  return new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 }).format(Math.round(cents / 100))
}
