/**
 * Unit tests for the pure helpers exported from the book route.
 *
 * Importing from a Next.js route file is supported — Vitest treats it as a
 * regular TS module. The route's POST handler is not invoked here; only the
 * exported helpers are tested in isolation.
 */
import { describe, it, expect } from 'vitest'
import { commissionForCampaign } from './route'

describe('commissionForCampaign', () => {
  it('rounds (base × percentage_value / 100) for percentage campaigns', () => {
    expect(commissionForCampaign(
      { percentage_value: 15, investment_type: 'percentage' },
      10000,
    )).toBe(1500)
  })

  it('uses Math.round (not floor) on percentage commissions', () => {
    // 10001 * 15 / 100 = 1500.15 → 1500 (rounds down)
    expect(commissionForCampaign(
      { percentage_value: 15, investment_type: 'percentage' },
      10001,
    )).toBe(1500)
    // 10004 * 15 / 100 = 1500.6 → 1501 (rounds up)
    expect(commissionForCampaign(
      { percentage_value: 15, investment_type: 'percentage' },
      10004,
    )).toBe(1501)
  })

  it('returns rounded percentage_value as cents for fixed_amount campaigns', () => {
    // For fixed_amount, percentage_value is reused as the fixed cents amount.
    expect(commissionForCampaign(
      { percentage_value: 500, investment_type: 'fixed_amount' },
      99999,
    )).toBe(500)
  })

  it('returns null when percentage_value is null (no commission configured)', () => {
    expect(commissionForCampaign(
      { percentage_value: null, investment_type: 'percentage' },
      10000,
    )).toBeNull()
  })

  it('returns null when percentage_value is 0 (falsy)', () => {
    expect(commissionForCampaign(
      { percentage_value: 0, investment_type: 'percentage' },
      10000,
    )).toBeNull()
  })

  it('returns null for unknown investment_type', () => {
    expect(commissionForCampaign(
      { percentage_value: 15, investment_type: 'something_else' },
      10000,
    )).toBeNull()
  })

  it('returns null for null/undefined campaign', () => {
    expect(commissionForCampaign(null, 10000)).toBeNull()
    expect(commissionForCampaign(undefined, 10000)).toBeNull()
  })

  it('returns 0 for percentage campaigns with zero base amount', () => {
    expect(commissionForCampaign(
      { percentage_value: 15, investment_type: 'percentage' },
      0,
    )).toBe(0)
  })
})
