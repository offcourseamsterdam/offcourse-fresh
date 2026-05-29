import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TIERS,
  normalizeTiers,
  hoursUntil,
  getRefundPercent,
  getNextCutoff,
  calculateRefundCents,
  formatTierLines,
  formatCutoffDateTime,
} from './policy'

// Helper: pick a fixed "now" so tests are deterministic.
const NOW = new Date('2026-05-08T10:00:00Z') // Fri 8 May 2026 10:00 UTC

// Departure 100 hours later: Tue 12 May 2026 14:00 UTC
const DEP_100H = new Date(NOW.getTime() + 100 * 60 * 60 * 1000)
// Departure 30 hours later: Sat 9 May 2026 16:00 UTC
const DEP_30H = new Date(NOW.getTime() + 30 * 60 * 60 * 1000)
// Departure 6 hours later: Fri 8 May 2026 16:00 UTC
const DEP_6H = new Date(NOW.getTime() + 6 * 60 * 60 * 1000)
// Departure in the past
const DEP_PAST = new Date(NOW.getTime() - 60 * 60 * 1000)

describe('normalizeTiers', () => {
  it('returns DEFAULT_TIERS for null input', () => {
    expect(normalizeTiers(null)).toEqual(DEFAULT_TIERS)
  })

  it('returns DEFAULT_TIERS for non-array input', () => {
    expect(normalizeTiers({})).toEqual(DEFAULT_TIERS)
    expect(normalizeTiers('48')).toEqual(DEFAULT_TIERS)
  })

  it('returns DEFAULT_TIERS for empty array', () => {
    expect(normalizeTiers([])).toEqual(DEFAULT_TIERS)
  })

  it('returns DEFAULT_TIERS when every item is invalid', () => {
    expect(normalizeTiers([{ foo: 1 }, null, 'nope'])).toEqual(DEFAULT_TIERS)
  })

  it('drops invalid items and keeps valid ones', () => {
    const result = normalizeTiers([
      { hours_before: 48, refund_percent: 100 },
      { hours_before: -1, refund_percent: 50 }, // invalid: negative hours
      { hours_before: 24, refund_percent: 150 }, // invalid: percent > 100
      { hours_before: 12, refund_percent: 25 },
    ])
    expect(result).toEqual([
      { hours_before: 48, refund_percent: 100 },
      { hours_before: 12, refund_percent: 25 },
    ])
  })

  it('sorts tiers descending by hours_before', () => {
    const result = normalizeTiers([
      { hours_before: 0, refund_percent: 0 },
      { hours_before: 48, refund_percent: 100 },
      { hours_before: 24, refund_percent: 50 },
    ])
    expect(result[0].hours_before).toBe(48)
    expect(result[1].hours_before).toBe(24)
    expect(result[2].hours_before).toBe(0)
  })
})

describe('hoursUntil', () => {
  it('returns positive hours for future departure', () => {
    expect(hoursUntil(DEP_30H, NOW)).toBeCloseTo(30)
  })

  it('returns negative hours for past departure', () => {
    expect(hoursUntil(DEP_PAST, NOW)).toBeCloseTo(-1)
  })

  it('returns ~0 for departure equal to now', () => {
    expect(hoursUntil(NOW, NOW)).toBe(0)
  })
})

describe('getRefundPercent', () => {
  it('returns 100 when more than 48h before departure', () => {
    expect(getRefundPercent(DEP_100H, DEFAULT_TIERS, NOW)).toBe(100)
  })

  it('returns 50 when 24–48h before departure', () => {
    expect(getRefundPercent(DEP_30H, DEFAULT_TIERS, NOW)).toBe(50)
  })

  it('returns 0 when within 24h of departure', () => {
    expect(getRefundPercent(DEP_6H, DEFAULT_TIERS, NOW)).toBe(0)
  })

  it('returns 0 when departure is in the past', () => {
    expect(getRefundPercent(DEP_PAST, DEFAULT_TIERS, NOW)).toBe(0)
  })

  it('respects exact tier boundary (>= matches the tier)', () => {
    const dep48 = new Date(NOW.getTime() + 48 * 60 * 60 * 1000)
    expect(getRefundPercent(dep48, DEFAULT_TIERS, NOW)).toBe(100)

    const dep24 = new Date(NOW.getTime() + 24 * 60 * 60 * 1000)
    expect(getRefundPercent(dep24, DEFAULT_TIERS, NOW)).toBe(50)
  })

  it('works with custom tiers', () => {
    const tiers = normalizeTiers([
      { hours_before: 72, refund_percent: 100 },
      { hours_before: 12, refund_percent: 25 },
    ])
    const dep80 = new Date(NOW.getTime() + 80 * 60 * 60 * 1000)
    const dep15 = new Date(NOW.getTime() + 15 * 60 * 60 * 1000)
    const dep5 = new Date(NOW.getTime() + 5 * 60 * 60 * 1000)
    expect(getRefundPercent(dep80, tiers, NOW)).toBe(100)
    expect(getRefundPercent(dep15, tiers, NOW)).toBe(25)
    expect(getRefundPercent(dep5, tiers, NOW)).toBe(0)
  })
})

describe('getNextCutoff', () => {
  it('returns the 48h cutoff when currently in 100% tier', () => {
    const result = getNextCutoff(DEP_100H, DEFAULT_TIERS, NOW)
    expect(result).not.toBeNull()
    expect(result!.refundPercent).toBe(100)
    // 48h before DEP_100H = NOW + (100-48)h = NOW + 52h
    const expected = new Date(NOW.getTime() + 52 * 60 * 60 * 1000)
    expect(result!.cutoffAt.getTime()).toBe(expected.getTime())
  })

  it('returns the 24h cutoff when currently in 50% tier', () => {
    const result = getNextCutoff(DEP_30H, DEFAULT_TIERS, NOW)
    expect(result).not.toBeNull()
    expect(result!.refundPercent).toBe(50)
    // 24h before DEP_30H = NOW + (30-24)h = NOW + 6h
    const expected = new Date(NOW.getTime() + 6 * 60 * 60 * 1000)
    expect(result!.cutoffAt.getTime()).toBe(expected.getTime())
  })

  it('returns null when within the lowest non-zero tier (no further refund tier below)', () => {
    expect(getNextCutoff(DEP_6H, DEFAULT_TIERS, NOW)).toBeNull()
  })

  it('returns null when departure is in the past', () => {
    expect(getNextCutoff(DEP_PAST, DEFAULT_TIERS, NOW)).toBeNull()
  })

  it('returns null when current tier is already 0%', () => {
    const tiers = normalizeTiers([{ hours_before: 0, refund_percent: 0 }])
    expect(getNextCutoff(DEP_100H, tiers, NOW)).toBeNull()
  })
})

describe('calculateRefundCents', () => {
  it('returns full amount when 100% refund tier active', () => {
    expect(calculateRefundCents(DEP_100H, DEFAULT_TIERS, 16500, NOW)).toBe(16500)
  })

  it('returns half amount (rounded) when 50% refund tier active', () => {
    expect(calculateRefundCents(DEP_30H, DEFAULT_TIERS, 16501, NOW)).toBe(8251) // round(8250.5)
  })

  it('returns 0 when within 24h', () => {
    expect(calculateRefundCents(DEP_6H, DEFAULT_TIERS, 16500, NOW)).toBe(0)
  })

  it('returns 0 for non-positive paid amount', () => {
    expect(calculateRefundCents(DEP_100H, DEFAULT_TIERS, 0, NOW)).toBe(0)
    expect(calculateRefundCents(DEP_100H, DEFAULT_TIERS, -100, NOW)).toBe(0)
  })
})

describe('formatTierLines', () => {
  it('formats default tiers correctly', () => {
    const lines = formatTierLines(DEFAULT_TIERS)
    expect(lines).toEqual([
      { refundPercent: 100, label: 'Full refund', detail: 'up to 48 hours before departure' },
      { refundPercent: 50, label: '50% refund', detail: '24–48 hours before departure' },
      { refundPercent: 0, label: 'No refund', detail: 'within 24 hours of departure' },
    ])
  })

  it('handles single-tier policy', () => {
    const tiers = normalizeTiers([{ hours_before: 24, refund_percent: 100 }])
    const lines = formatTierLines(tiers)
    expect(lines).toHaveLength(1)
    expect(lines[0].label).toBe('Full refund')
  })
})

describe('formatCutoffDateTime', () => {
  it('formats a date in en-GB style with Amsterdam timezone', () => {
    // 2026-05-08 13:30 UTC → 15:30 Europe/Amsterdam (CEST = UTC+2)
    const d = new Date('2026-05-08T13:30:00Z')
    const formatted = formatCutoffDateTime(d)
    expect(formatted).toContain('Fri')
    expect(formatted).toContain('May')
    expect(formatted).toContain('15:30')
  })
})
