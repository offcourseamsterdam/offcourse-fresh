import { describe, it, expect } from 'vitest'
import { shiftCostCents, fmtCostEuros } from './shift-cost'

describe('shiftCostCents', () => {
  it('multiplies hourly rate by shift duration in hours', () => {
    // 2 hours at €25/h = €50
    expect(shiftCostCents(2500, '2026-08-06T15:00:00Z', '2026-08-06T17:00:00Z')).toBe(5000)
  })

  it('handles a fractional-hour shift (1.5h)', () => {
    expect(shiftCostCents(2000, '2026-08-06T15:00:00Z', '2026-08-06T16:30:00Z')).toBe(3000)
  })

  it('rounds to the nearest cent instead of truncating', () => {
    // 1 minute at €10/h = 1000/60 = 16.6667 cents -> rounds to 17, not truncated to 16
    expect(shiftCostCents(1000, '2026-08-06T15:00:00Z', '2026-08-06T15:01:00Z')).toBe(17)
  })

  it('returns 0 for a zero-length or inverted range instead of a negative number', () => {
    expect(shiftCostCents(2500, '2026-08-06T15:00:00Z', '2026-08-06T15:00:00Z')).toBe(0)
    expect(shiftCostCents(2500, '2026-08-06T17:00:00Z', '2026-08-06T15:00:00Z')).toBe(0)
  })

  it('returns 0 for an unparseable date rather than NaN', () => {
    expect(shiftCostCents(2500, 'not-a-date', '2026-08-06T17:00:00Z')).toBe(0)
  })
})

describe('fmtCostEuros', () => {
  it('formats cents as euros with two decimals', () => {
    expect(fmtCostEuros(5000)).toBe('€50.00')
    expect(fmtCostEuros(2350)).toBe('€23.50')
    expect(fmtCostEuros(23)).toBe('€0.23')
  })
})
