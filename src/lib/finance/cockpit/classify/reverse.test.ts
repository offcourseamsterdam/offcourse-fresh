import { describe, it, expect } from 'vitest'
import { reverseChanges, sameEffects } from './reverse'
import type { AllocationChange } from './allocation-effect'

const salary: AllocationChange = { kind: 'owner_salary_drawdown', amountCents: 300_000, newCoverageCents: 600_000, reason: 'x' }
const goalDown: AllocationChange = { kind: 'goal_drawdown', goalId: 'g1', amountCents: 100_000, newFundedCents: 540_000, reason: 'x' }
const goalDone: AllocationChange = { kind: 'goal_completed', goalId: 'g1', releasedCents: 640_000, overspendCents: 0, reason: 'x' }
const oblPaid: AllocationChange = { kind: 'obligation_paid', obligationId: 'o1', amountCents: 680_000, reason: 'x' }
const loanPaid: AllocationChange = { kind: 'loan_payment_paid', loanPaymentId: 'p1', amountCents: 18_000, reason: 'x' }

describe('reverseChanges', () => {
  it('gives back nothing when the transaction never touched the plan', () => {
    expect(reverseChanges(null)).toEqual([])
    expect(reverseChanges([])).toEqual([])
  })

  it('puts the salary buffer back by exactly what was drawn', () => {
    expect(reverseChanges([salary])).toEqual([{ kind: 'owner_salary_restore', amountCents: 300_000 }])
  })

  it('restores a goal drawdown', () => {
    expect(reverseChanges([goalDown])).toEqual([{ kind: 'goal_restore', goalId: 'g1', amountCents: 100_000 }])
  })

  it('reopens a completed goal with the funding it had at completion', () => {
    expect(reverseChanges([goalDone])).toEqual([{ kind: 'goal_reopen', goalId: 'g1', restoreFundedCents: 640_000 }])
  })

  it('reopens a paid obligation and a paid loan period', () => {
    expect(reverseChanges([oblPaid, loanPaid])).toEqual([
      { kind: 'loan_payment_reopen', loanPaymentId: 'p1' },
      { kind: 'obligation_reopen', obligationId: 'o1' },
    ])
  })

  it('undoes in the opposite order, so a completion is unwound before the drawdown before it', () => {
    expect(reverseChanges([goalDown, goalDone]).map(o => o.kind)).toEqual(['goal_reopen', 'goal_restore'])
  })
})

describe('sameEffects', () => {
  it('recognises an unchanged outcome so nothing has to be rewritten', () => {
    expect(sameEffects([salary], [{ ...salary, reason: 'andere tekst' }])).toBe(true)
    expect(sameEffects(null, [])).toBe(true)
  })

  it('spots a different amount, a different target, and a different length', () => {
    expect(sameEffects([salary], [{ ...salary, amountCents: 1 }])).toBe(false)
    expect(sameEffects([goalDown], [{ ...goalDown, goalId: 'g2' }])).toBe(false)
    expect(sameEffects([salary], [salary, goalDown])).toBe(false)
    expect(sameEffects([goalDown], [goalDone])).toBe(false)
  })
})
