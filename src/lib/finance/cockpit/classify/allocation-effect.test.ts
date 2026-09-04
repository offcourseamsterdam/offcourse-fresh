import { describe, it, expect } from 'vitest'
import { allocationEffects, type AllocationState, type EffectInput } from './allocation-effect'

const allocation = (o: Partial<AllocationState> = {}): AllocationState => ({
  ownerSalaryCoverageCents: 900_000,
  goals: [{ id: 'g1', name: "Nieuwe accu's", targetCents: 1_000_000, fundedCents: 640_000, status: 'active' }],
  obligations: [{ id: 'o1', title: 'BTW Q3', amountCents: 680_000, status: 'open' }],
  loanPayments: [{ id: 'p1', loanName: 'Lening Tijs Louman', dueDate: '2026-10-01', totalCents: 18_000, isPaid: false }],
  ...o,
})

const input = (o: Partial<EffectInput> = {}): EffectInput => ({
  amountCents: -300_000,
  state: 'completed',
  classification: { category: 'operating', subcategory: 'other' },
  allocation: allocation(),
  ...o,
})

describe('allocationEffects — nothing happens until the money has really moved', () => {
  it.each(['pending', 'created', 'declined', 'failed', 'reverted'])('state %s produces no changes', state => {
    expect(allocationEffects(input({ state, classification: { category: 'owner', subcategory: 'salary' } }))).toEqual([])
  })
})

describe('allocationEffects — owner salary', () => {
  it('draws the payment off the buffer', () => {
    const [change] = allocationEffects(input({ classification: { category: 'owner', subcategory: 'salary' } }))
    expect(change).toMatchObject({ kind: 'owner_salary_drawdown', amountCents: 300_000, newCoverageCents: 600_000 })
  })

  it('never lets the buffer go below zero when more is paid than was reserved', () => {
    const [change] = allocationEffects(input({
      amountCents: -1_200_000,
      classification: { category: 'owner', subcategory: 'salary' },
    }))
    expect(change).toMatchObject({ kind: 'owner_salary_drawdown', amountCents: 900_000, newCoverageCents: 0 })
  })

  it('does nothing when there is no buffer left', () => {
    expect(allocationEffects(input({
      classification: { category: 'owner', subcategory: 'salary' },
      allocation: allocation({ ownerSalaryCoverageCents: 0 }),
    }))).toEqual([])
  })

  it('an owner withdrawal is not a salary payment and leaves the buffer alone', () => {
    expect(allocationEffects(input({ classification: { category: 'owner', subcategory: 'withdrawal' } }))).toEqual([])
  })
})

describe('allocationEffects — goals', () => {
  it('a partial purchase draws the goal down without completing it', () => {
    const [change] = allocationEffects(input({ amountCents: -100_000, classification: { category: 'maintenance', subcategory: 'batteries', goalId: 'g1' } }))
    expect(change).toMatchObject({ kind: 'goal_drawdown', goalId: 'g1', amountCents: 100_000, newFundedCents: 540_000 })
  })

  it('a purchase that reaches the target completes the goal and releases the reservation', () => {
    const [change] = allocationEffects(input({ amountCents: -870_000, classification: { category: 'maintenance', subcategory: 'batteries', goalId: 'g1' } }))
    expect(change).toMatchObject({ kind: 'goal_completed', goalId: 'g1', releasedCents: 640_000, overspendCents: 0 })
  })

  it('spending more than the target reports the overspend instead of a negative goal', () => {
    const [change] = allocationEffects(input({ amountCents: -1_200_000, classification: { category: 'maintenance', subcategory: 'batteries', goalId: 'g1' } }))
    expect(change).toMatchObject({ kind: 'goal_completed', overspendCents: 200_000 })
    expect(change).not.toHaveProperty('newFundedCents')
  })

  it('ignores a goal that is not active, and an unknown goal id', () => {
    expect(allocationEffects(input({
      classification: { category: 'maintenance', subcategory: 'batteries', goalId: 'g1' },
      allocation: allocation({ goals: [{ id: 'g1', name: 'x', targetCents: 100, fundedCents: 100, status: 'completed' }] }),
    }))).toEqual([])
    expect(allocationEffects(input({ classification: { category: 'maintenance', subcategory: 'batteries', goalId: 'nope' } }))).toEqual([])
  })

  it('money coming in never touches a goal', () => {
    expect(allocationEffects(input({ amountCents: 500_000, classification: { category: 'income', subcategory: 'booking', goalId: 'g1' } }))).toEqual([])
  })
})

describe('allocationEffects — dated commitments', () => {
  it('marks the linked obligation paid for its own amount, not the transaction amount', () => {
    const [change] = allocationEffects(input({ amountCents: -679_500, classification: { category: 'tax', subcategory: 'vat', obligationId: 'o1' } }))
    expect(change).toMatchObject({ kind: 'obligation_paid', obligationId: 'o1', amountCents: 680_000 })
  })

  it('marks the linked loan period paid', () => {
    const [change] = allocationEffects(input({ amountCents: -18_000, classification: { category: 'financing', subcategory: 'loan_repayment', loanPaymentId: 'p1' } }))
    expect(change).toMatchObject({ kind: 'loan_payment_paid', loanPaymentId: 'p1', amountCents: 18_000 })
  })

  it('does not pay something twice', () => {
    expect(allocationEffects(input({
      classification: { category: 'financing', subcategory: 'loan_repayment', loanPaymentId: 'p1' },
      allocation: allocation({ loanPayments: [{ id: 'p1', loanName: 'x', dueDate: '2026-10-01', totalCents: 18_000, isPaid: true }] }),
    }))).toEqual([])
    expect(allocationEffects(input({
      classification: { category: 'tax', subcategory: 'vat', obligationId: 'o1' },
      allocation: allocation({ obligations: [{ id: 'o1', title: 'BTW Q3', amountCents: 680_000, status: 'paid' }] }),
    }))).toEqual([])
  })
})

describe('allocationEffects — everything else is inert', () => {
  it('booking revenue changes no pot; the cash balance already moved', () => {
    expect(allocationEffects(input({ amountCents: 250_000, classification: { category: 'income', subcategory: 'booking' } }))).toEqual([])
  })
  it('an ordinary supplier payment changes no pot', () => {
    expect(allocationEffects(input({ classification: { category: 'operating', subcategory: 'catering' } }))).toEqual([])
  })
  it('an internal transfer changes no pot', () => {
    expect(allocationEffects(input({ classification: { category: 'transfer', subcategory: 'internal' } }))).toEqual([])
  })
})
