import { describe, it, expect } from 'vitest'
import { fmtAdminDate, fmtAdminTime, fmtAdminAmount, fmtAdminAmountRounded, fmtAdminDatetime } from './format'

describe('fmtAdminDate', () => {
  it('formats a date string', () => {
    expect(fmtAdminDate('2026-04-28')).toBe('28 apr 2026')
  })
  it('returns — for null', () => {
    expect(fmtAdminDate(null)).toBe('—')
  })
  it('handles ISO datetime strings', () => {
    const result = fmtAdminDate('2026-04-28T14:00:00+02:00')
    expect(result).toBe('28 apr 2026')
  })
})

describe('fmtAdminTime', () => {
  it('returns — for null', () => {
    expect(fmtAdminTime(null)).toBe('—')
  })
  it('formats a time from ISO string in Amsterdam TZ', () => {
    // 12:00 UTC = 14:00 Amsterdam (CEST)
    const result = fmtAdminTime('2026-04-28T12:00:00Z')
    expect(result).toBe('14:00')
  })
})

describe('fmtAdminAmount', () => {
  it('formats cents as euros with 2 decimals', () => {
    expect(fmtAdminAmount(16500)).toBe('€165,00')
  })
  it('returns — for null', () => {
    expect(fmtAdminAmount(null)).toBe('—')
  })
  it('returns — for 0', () => {
    expect(fmtAdminAmount(0)).toBe('—')
  })
})

describe('fmtAdminAmountRounded', () => {
  it('formats cents as rounded euros', () => {
    expect(fmtAdminAmountRounded(16500)).toBe('€165')
  })
  it('returns — for null', () => {
    expect(fmtAdminAmountRounded(null)).toBe('—')
  })
})

describe('fmtAdminDatetime', () => {
  it('returns — for null', () => {
    expect(fmtAdminDatetime(null)).toBe('—')
  })
  it('formats date + time', () => {
    const result = fmtAdminDatetime('2026-04-28T12:00:00Z')
    expect(typeof result).toBe('string')
    expect(result).toContain('28')
    expect(result).toContain('apr')
  })
})
