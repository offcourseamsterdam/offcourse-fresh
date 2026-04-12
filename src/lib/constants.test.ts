import { describe, it, expect } from 'vitest'
import { CATEGORY_EMOJI, EXTRAS_CATEGORIES, PRICE_TYPES, VAT_RATES, formatExtraPrice, LISTING_CATEGORIES } from './constants'

describe('CATEGORY_EMOJI', () => {
  it('has an emoji for every extras category', () => {
    for (const cat of EXTRAS_CATEGORIES) {
      expect(CATEGORY_EMOJI[cat]).toBeDefined()
      expect(CATEGORY_EMOJI[cat].length).toBeGreaterThan(0)
    }
  })
})

describe('PRICE_TYPES', () => {
  it('has 5 price types', () => {
    expect(PRICE_TYPES).toHaveLength(5)
  })

  it('includes all expected values', () => {
    const values = PRICE_TYPES.map(pt => pt.value)
    expect(values).toContain('fixed_cents')
    expect(values).toContain('percentage')
    expect(values).toContain('per_person_cents')
    expect(values).toContain('per_person_per_hour_cents')
    expect(values).toContain('informational')
  })
})

describe('formatExtraPrice', () => {
  it('formats fixed price', () => {
    expect(formatExtraPrice({ price_type: 'fixed_cents', price_value: 2500 })).toBe('€25.00')
  })

  it('formats percentage', () => {
    expect(formatExtraPrice({ price_type: 'percentage', price_value: 10 })).toBe('10%')
  })

  it('formats per-person price', () => {
    expect(formatExtraPrice({ price_type: 'per_person_cents', price_value: 200 })).toBe('€2.00/person')
  })

  it('formats informational', () => {
    expect(formatExtraPrice({ price_type: 'informational', price_value: 0 })).toBe('Info only')
  })
})

describe('VAT_RATES', () => {
  it('contains expected rates', () => {
    expect(VAT_RATES).toContain(0)
    expect(VAT_RATES).toContain(9)
    expect(VAT_RATES).toContain(21)
  })
})

describe('LISTING_CATEGORIES', () => {
  it('includes private and shared', () => {
    expect(LISTING_CATEGORIES).toContain('private')
    expect(LISTING_CATEGORIES).toContain('shared')
  })
})
