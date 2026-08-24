import { describe, it, expect } from 'vitest'
import { commissionCentsFor, EXTRA_HOURS_COMMISSION_RATE } from './extra-hours-bonus'

describe('commissionCentsFor', () => {
  it('is 50% of what was charged (Beer, 2026-08-24)', () => {
    expect(EXTRA_HOURS_COMMISSION_RATE).toBe(0.5)
    expect(commissionCentsFor(2000)).toBe(1000)
  })

  it('rounds to the nearest cent', () => {
    expect(commissionCentsFor(2001)).toBe(1001) // 1000.5 -> 1001
    expect(commissionCentsFor(1999)).toBe(1000) // 999.5 -> 1000 (round-half-up)
  })

  it('handles zero', () => {
    expect(commissionCentsFor(0)).toBe(0)
  })
})
