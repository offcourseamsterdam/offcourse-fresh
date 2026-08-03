import { describe, it, expect } from 'vitest'
import { getWeekStart, addDays, weekDateStrings, formatWeekRangeLabel, amsDateString } from './week'

describe('getWeekStart', () => {
  it('returns the same Monday when given a Monday', () => {
    // Monday 6 July 2026, 10:00 UTC (= 12:00 Amsterdam CEST)
    const monday = new Date('2026-07-06T10:00:00Z')
    expect(amsDateString(getWeekStart(monday))).toBe('2026-07-06')
  })

  it('steps back to Monday when given a mid-week day', () => {
    // Thursday 9 July 2026
    const thursday = new Date('2026-07-09T10:00:00Z')
    expect(amsDateString(getWeekStart(thursday))).toBe('2026-07-06')
  })

  it('steps back to Monday when given a Sunday (dow=0 edge case)', () => {
    // Sunday 12 July 2026
    const sunday = new Date('2026-07-12T10:00:00Z')
    expect(amsDateString(getWeekStart(sunday))).toBe('2026-07-06')
  })

  it('handles a month boundary correctly', () => {
    // Wednesday 1 July 2026 → week starts Monday 29 June 2026
    const wed = new Date('2026-07-01T10:00:00Z')
    expect(amsDateString(getWeekStart(wed))).toBe('2026-06-29')
  })

  it('returns exactly midnight Amsterdam time, not just the right calendar date', () => {
    // Regression: an earlier version computed the right DATE but the wrong INSTANT
    // (off by the local/Amsterdam offset), which a plain date-string comparison
    // wouldn't catch. Assert the precise UTC instant for Monday 29 June 2026 00:00
    // Amsterdam (CEST, UTC+2) = 2026-06-28T22:00:00Z.
    const wed = new Date('2026-07-01T10:00:00Z')
    const result = getWeekStart(wed)
    expect(result.getTime()).toBe(new Date('2026-06-28T22:00:00Z').getTime())
  })

  it('is stable near UTC midnight in Amsterdam summer time', () => {
    // 22:30 UTC on 5 July (Sunday) is already 00:30 on 6 July (Monday) in Amsterdam (CEST, UTC+2)
    const lateUtc = new Date('2026-07-05T22:30:00Z')
    expect(amsDateString(getWeekStart(lateUtc))).toBe('2026-07-06')
  })
})

describe('addDays', () => {
  it('adds calendar days forward', () => {
    const start = new Date('2026-07-06T10:00:00Z')
    expect(amsDateString(addDays(start, 3))).toBe('2026-07-09')
  })

  it('rolls over a month boundary', () => {
    const start = new Date('2026-07-29T10:00:00Z')
    expect(amsDateString(addDays(start, 7))).toBe('2026-08-05')
  })
})

describe('weekDateStrings', () => {
  it('returns 7 consecutive Mon–Sun date strings', () => {
    const monday = new Date('2026-07-06T00:00:00Z')
    expect(weekDateStrings(monday)).toEqual([
      '2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09',
      '2026-07-10', '2026-07-11', '2026-07-12',
    ])
  })
})

describe('formatWeekRangeLabel', () => {
  it('formats a week within a single month', () => {
    const monday = new Date('2026-07-06T00:00:00Z')
    expect(formatWeekRangeLabel(monday)).toBe('6 – 12 Jul 2026')
  })

  it('formats a week that crosses a month boundary', () => {
    const monday = new Date('2026-06-29T00:00:00Z')
    expect(formatWeekRangeLabel(monday)).toBe('29 Jun – 5 Jul 2026')
  })
})
