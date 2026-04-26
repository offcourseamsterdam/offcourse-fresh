import { describe, it, expect } from 'vitest'
import {
  quarterFromDate,
  currentQuarter,
  quarterRange,
  quarterLabel,
  previousQuarters,
} from './quarters'

describe('quarterFromDate', () => {
  it('Jan 1 → Q1', () => {
    expect(quarterFromDate(new Date(Date.UTC(2026, 0, 1)))).toBe('2026-Q1')
  })

  it('Mar 31 → Q1', () => {
    expect(quarterFromDate(new Date(Date.UTC(2026, 2, 31)))).toBe('2026-Q1')
  })

  it('Apr 1 → Q2', () => {
    expect(quarterFromDate(new Date(Date.UTC(2026, 3, 1)))).toBe('2026-Q2')
  })

  it('Jun 30 → Q2', () => {
    expect(quarterFromDate(new Date(Date.UTC(2026, 5, 30)))).toBe('2026-Q2')
  })

  it('Jul 1 → Q3', () => {
    expect(quarterFromDate(new Date(Date.UTC(2026, 6, 1)))).toBe('2026-Q3')
  })

  it('Sep 30 → Q3', () => {
    expect(quarterFromDate(new Date(Date.UTC(2026, 8, 30)))).toBe('2026-Q3')
  })

  it('Oct 1 → Q4', () => {
    expect(quarterFromDate(new Date(Date.UTC(2026, 9, 1)))).toBe('2026-Q4')
  })

  it('Dec 31 → Q4', () => {
    expect(quarterFromDate(new Date(Date.UTC(2026, 11, 31)))).toBe('2026-Q4')
  })

  it('accepts ISO string input', () => {
    expect(quarterFromDate('2026-04-15')).toBe('2026-Q2')
  })

  it('handles leap-year Feb 29', () => {
    expect(quarterFromDate(new Date(Date.UTC(2024, 1, 29)))).toBe('2024-Q1')
  })
})

describe('currentQuarter', () => {
  it('returns quarter for given date', () => {
    expect(currentQuarter(new Date(Date.UTC(2026, 4, 15)))).toBe('2026-Q2')
  })
})

describe('quarterRange', () => {
  it('Q1 spans Jan 1 → Apr 1', () => {
    const { start, endExclusive } = quarterRange('2026-Q1')
    expect(start.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(endExclusive.toISOString()).toBe('2026-04-01T00:00:00.000Z')
  })

  it('Q4 spans Oct 1 → Jan 1 next year', () => {
    const { start, endExclusive } = quarterRange('2026-Q4')
    expect(start.toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(endExclusive.toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })

  it('throws on invalid format', () => {
    expect(() => quarterRange('2026-5')).toThrow()
    expect(() => quarterRange('not-a-quarter')).toThrow()
  })
})

describe('quarterLabel', () => {
  it('formats Q1 as Jan – Mar', () => {
    expect(quarterLabel('2026-Q1')).toBe('Jan – Mar 2026')
  })

  it('formats Q2 as Apr – Jun', () => {
    expect(quarterLabel('2026-Q2')).toBe('Apr – Jun 2026')
  })

  it('formats Q3 as Jul – Sep', () => {
    expect(quarterLabel('2026-Q3')).toBe('Jul – Sep 2026')
  })

  it('formats Q4 as Oct – Dec', () => {
    expect(quarterLabel('2026-Q4')).toBe('Oct – Dec 2026')
  })
})

describe('previousQuarters', () => {
  it('returns 4 previous quarters in chronological order from Q2 2026', () => {
    expect(previousQuarters(4, new Date(Date.UTC(2026, 4, 1)))).toEqual([
      '2025-Q2',
      '2025-Q3',
      '2025-Q4',
      '2026-Q1',
    ])
  })

  it('handles year rollover crossing Q1', () => {
    expect(previousQuarters(2, new Date(Date.UTC(2026, 0, 15)))).toEqual([
      '2025-Q3',
      '2025-Q4',
    ])
  })

  it('returns empty array for count=0', () => {
    expect(previousQuarters(0)).toEqual([])
  })
})
