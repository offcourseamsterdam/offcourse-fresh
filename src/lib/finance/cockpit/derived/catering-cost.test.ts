import { describe, it, expect } from 'vitest'
import { estimateCateringSpend, estimateCostFromSellPrice, estimateExtraCost, isCateringExtra, type CateringExtra } from './catering-cost'

describe('estimateCostFromSellPrice — sell = cost × 1.3', () => {
  it('divides out the 30% markup', () => {
    expect(estimateCostFromSellPrice(1300)).toBe(1000)
    expect(estimateCostFromSellPrice(2600)).toBe(2000)
  })
  it('accepts a different markup', () => {
    expect(estimateCostFromSellPrice(1500, 50)).toBe(1000)
  })
  it('never goes negative and treats zero as zero', () => {
    expect(estimateCostFromSellPrice(0)).toBe(0)
    expect(estimateCostFromSellPrice(-500)).toBe(0)
  })
})

describe('isCateringExtra', () => {
  it('food and drinks count, info does not', () => {
    expect(isCateringExtra('food')).toBe(true)
    expect(isCateringExtra('drinks')).toBe(true)
    expect(isCateringExtra('info')).toBe(false)
  })
})

describe('estimateExtraCost', () => {
  it('reports sell, estimated cost, and the estimated margin', () => {
    const extra: CateringExtra = { id: 'e1', name: 'Jamaican Buffet', category: 'food', priceValueCents: 1450 }
    expect(estimateExtraCost(extra)).toMatchObject({ sellPriceCents: 1450, estimatedCostCents: 1115, estimatedMarginCents: 335 })
  })
})

describe('estimateCateringSpend', () => {
  const extras: CateringExtra[] = [
    { id: 'buffet', name: 'Jamaican Buffet', category: 'food', priceValueCents: 1450 },
    { id: 'drinks', name: 'Unlimited Drinks', category: 'drinks', priceValueCents: 350 },
    { id: 'cancel', name: 'Cancellation Policy', category: 'info', priceValueCents: 0 },
  ]

  it('sums estimated cost across a period, weighted by quantity', () => {
    const r = estimateCateringSpend(extras, [
      { extraId: 'buffet', quantity: 6, date: '2026-08-10' },
      { extraId: 'drinks', quantity: 6, date: '2026-08-10' },
      { extraId: 'buffet', quantity: 8, date: '2026-08-20' },
    ], { from: '2026-08-01', to: '2026-08-31' })
    // buffet cost ≈ €11.15 × 14 = €156.10; drinks cost ≈ €2.69 × 6 = €16.15 (rounded per line)
    expect(r.estimatedCostCents).toBe(1115 * 14 + 269 * 6)
    expect(r.lineCount).toBe(3)
  })

  it('excludes non-catering extras even when a sale line references one', () => {
    const r = estimateCateringSpend(extras, [{ extraId: 'cancel', quantity: 1, date: '2026-08-10' }], { from: '2026-08-01', to: '2026-08-31' })
    expect(r.lineCount).toBe(0)
    expect(r.unknownExtraIds).toEqual(['cancel'])
  })

  it('excludes sales outside the requested period', () => {
    const r = estimateCateringSpend(extras, [{ extraId: 'buffet', quantity: 1, date: '2026-07-31' }], { from: '2026-08-01', to: '2026-08-31' })
    expect(r.lineCount).toBe(0)
  })

  it('names an extra that was sold but no longer exists in the catalogue', () => {
    const r = estimateCateringSpend(extras, [{ extraId: 'discontinued', quantity: 2, date: '2026-08-10' }], { from: '2026-08-01', to: '2026-08-31' })
    expect(r.unknownExtraIds).toEqual(['discontinued'])
    expect(r.estimatedCostCents).toBe(0)
  })
})
