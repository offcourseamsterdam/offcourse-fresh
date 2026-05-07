import { describe, it, expect } from 'vitest'
import { filterCateringItems, hasCatering, cateringAmountCents } from './filter'
import type { ExtrasLineItem } from './filter'

const food: ExtrasLineItem = { name: 'Cheese platter', amount_cents: 1500, category: 'food', extra_id: 'e1', quantity: 1 }
const drinks: ExtrasLineItem = { name: 'Wine package', amount_cents: 2000, category: 'drinks', extra_id: 'e2', quantity: 2 }
const protection: ExtrasLineItem = { name: 'Insurance', amount_cents: 500, category: 'protection' }
const taxItem: ExtrasLineItem = { name: 'City tax', amount_cents: 520, category: 'tax' }
const noCat: ExtrasLineItem = { name: 'Legacy item', amount_cents: 300 }

describe('filterCateringItems', () => {
  it('returns empty array for null', () => {
    expect(filterCateringItems(null)).toEqual([])
  })

  it('returns empty array for undefined', () => {
    expect(filterCateringItems(undefined)).toEqual([])
  })

  it('returns empty array for empty array', () => {
    expect(filterCateringItems([])).toEqual([])
  })

  it('returns only food and drinks items', () => {
    const result = filterCateringItems([food, drinks, protection, taxItem])
    expect(result).toHaveLength(2)
    expect(result).toContain(food)
    expect(result).toContain(drinks)
  })

  it('excludes items with no category', () => {
    const result = filterCateringItems([noCat, food])
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(food)
  })

  it('returns empty array when no catering items exist', () => {
    expect(filterCateringItems([protection, taxItem, noCat])).toEqual([])
  })

  it('handles only food items', () => {
    const result = filterCateringItems([food])
    expect(result).toEqual([food])
  })

  it('handles only drinks items', () => {
    const result = filterCateringItems([drinks])
    expect(result).toEqual([drinks])
  })
})

describe('hasCatering', () => {
  it('returns false for null', () => {
    expect(hasCatering(null)).toBe(false)
  })

  it('returns false for empty array', () => {
    expect(hasCatering([])).toBe(false)
  })

  it('returns false when only non-catering items', () => {
    expect(hasCatering([protection, taxItem])).toBe(false)
  })

  it('returns true when food item present', () => {
    expect(hasCatering([food, protection])).toBe(true)
  })

  it('returns true when drinks item present', () => {
    expect(hasCatering([drinks])).toBe(true)
  })
})

describe('cateringAmountCents', () => {
  it('returns 0 for null', () => {
    expect(cateringAmountCents(null)).toBe(0)
  })

  it('returns 0 for empty array', () => {
    expect(cateringAmountCents([])).toBe(0)
  })

  it('returns 0 when no catering items', () => {
    expect(cateringAmountCents([protection, taxItem])).toBe(0)
  })

  it('sums catering items only', () => {
    expect(cateringAmountCents([food, drinks, protection])).toBe(3500)
  })

  it('handles single item', () => {
    expect(cateringAmountCents([food])).toBe(1500)
  })
})
