import { describe, it, expect } from 'vitest'
import { isChildLabel, countAdultsFromFHCustomers } from './adult-count'

describe('isChildLabel', () => {
  it('treats "Child (0-12)" as a child', () => {
    expect(isChildLabel('Child (0-12)')).toBe(true)
  })
  it('treats "Adult (13+)" as an adult', () => {
    expect(isChildLabel('Adult (13+)')).toBe(false)
  })
  it('matches the "(0-" age-range marker even without the word child', () => {
    expect(isChildLabel('Kids (0-11)')).toBe(true)
  })
  it('is case-insensitive', () => {
    expect(isChildLabel('CHILD')).toBe(true)
  })
  it('treats null/empty/undefined as adult (safe default — never under-counts adults)', () => {
    expect(isChildLabel(null)).toBe(false)
    expect(isChildLabel(undefined)).toBe(false)
    expect(isChildLabel('')).toBe(false)
  })
})

describe('countAdultsFromFHCustomers', () => {
  const adult = { customer_type_rate: { customer_type: { singular: 'Adult (13+)' } } }
  const child = { customer_type_rate: { customer_type: { singular: 'Child (0-12)' } } }

  it('counts 1 adult in an adult + child booking (Gertjan upsell case)', () => {
    expect(countAdultsFromFHCustomers([adult, child])).toBe(1)
  })
  it('counts all adults when there are no children', () => {
    expect(countAdultsFromFHCustomers([adult, adult, adult])).toBe(3)
  })
  it('counts 0 adults for an all-children booking', () => {
    expect(countAdultsFromFHCustomers([child, child])).toBe(0)
  })
  it('returns 0 for an empty customers array', () => {
    expect(countAdultsFromFHCustomers([])).toBe(0)
  })
  it('treats customers with a missing type name as adults (never under-counts)', () => {
    expect(countAdultsFromFHCustomers([{}, adult])).toBe(2)
  })
})
