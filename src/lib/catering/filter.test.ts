import { describe, it, expect } from 'vitest'
import { filterCateringItems, hasCatering, cateringAmountCents } from './filter'
import type { ExtrasLineItem } from './filter'

// Catering = food only. Drinks are handled onboard.
const food: ExtrasLineItem = { name: 'Cheese platter', amount_cents: 1500, category: 'food', extra_id: 'e1', quantity: 1 }
const food2: ExtrasLineItem = { name: 'Charcuterie board', amount_cents: 2000, category: 'food', extra_id: 'e3', quantity: 1 }
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

  it('returns only food items — drinks are handled onboard, not catering', () => {
    const result = filterCateringItems([food, drinks, protection, taxItem])
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(food)
  })

  it('excludes drinks items', () => {
    expect(filterCateringItems([drinks])).toEqual([])
  })

  it('excludes items with no category', () => {
    const result = filterCateringItems([noCat, food])
    expect(result).toHaveLength(1)
    expect(result[0]).toBe(food)
  })

  it('returns empty array when no food items exist', () => {
    expect(filterCateringItems([drinks, protection, taxItem, noCat])).toEqual([])
  })

  it('handles multiple food items', () => {
    const result = filterCateringItems([food, food2])
    expect(result).toHaveLength(2)
  })
})

describe('hasCatering', () => {
  it('returns false for null', () => {
    expect(hasCatering(null)).toBe(false)
  })

  it('returns false for empty array', () => {
    expect(hasCatering([])).toBe(false)
  })

  it('returns false when only non-food items', () => {
    expect(hasCatering([drinks, protection, taxItem])).toBe(false)
  })

  it('returns false for drinks-only (handled onboard)', () => {
    expect(hasCatering([drinks])).toBe(false)
  })

  it('returns true when food item present', () => {
    expect(hasCatering([food, protection])).toBe(true)
  })

  it('returns true when food present alongside drinks', () => {
    expect(hasCatering([food, drinks])).toBe(true)
  })
})

describe('cateringAmountCents', () => {
  it('returns 0 for null', () => {
    expect(cateringAmountCents(null)).toBe(0)
  })

  it('returns 0 for empty array', () => {
    expect(cateringAmountCents([])).toBe(0)
  })

  it('returns 0 when no food items (drinks excluded)', () => {
    expect(cateringAmountCents([drinks, protection, taxItem])).toBe(0)
  })

  it('sums food items only — ignores drinks and other categories', () => {
    expect(cateringAmountCents([food, drinks, protection])).toBe(1500)
  })

  it('sums multiple food items', () => {
    expect(cateringAmountCents([food, food2])).toBe(3500)
  })

  it('handles single food item', () => {
    expect(cateringAmountCents([food])).toBe(1500)
  })
})
