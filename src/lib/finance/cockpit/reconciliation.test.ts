import { describe, it, expect } from 'vitest'
import { checkReconciliation } from './reconciliation'

describe('checkReconciliation', () => {
  it('a brand new connection with no completed transaction yet has nothing to reconcile against', () => {
    expect(checkReconciliation(500000, null)).toEqual({ gapCents: 0, expectedCents: null })
  })

  it('balance matches the last transaction\'s own stamped balance exactly → no gap', () => {
    expect(checkReconciliation(500000, 500000)).toEqual({ gapCents: 0, expectedCents: 500000 })
  })

  it('the bank balance is higher than what our ledger explains → positive gap', () => {
    expect(checkReconciliation(500000, 480000)).toEqual({ gapCents: 20000, expectedCents: 480000 })
  })

  it('the bank balance is lower than what our ledger explains → negative gap', () => {
    expect(checkReconciliation(480000, 500000)).toEqual({ gapCents: -20000, expectedCents: 500000 })
  })
})
