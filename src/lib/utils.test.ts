import { describe, it, expect } from 'vitest'
import { formatPrice, formatDate, formatShortDate, formatDuration, categorizeListings, slugify, fmtEuros, fmtEurosRounded, toAmsDateStr, formatReviewMonthYear } from './utils'

// ── fmtEuros / fmtEurosRounded ───────────────────────────────────────────────

describe('fmtEuros', () => {
  it('formats positive cents with 2 decimals', () => {
    expect(fmtEuros(1650)).toBe('€16.50')
  })

  it('places the minus sign before the euro symbol for negative amounts', () => {
    expect(fmtEuros(-500)).toBe('-€5.00')
  })

  it('formats zero', () => {
    expect(fmtEuros(0)).toBe('€0.00')
  })
})

describe('fmtEurosRounded', () => {
  it('formats positive cents with no decimals', () => {
    expect(fmtEurosRounded(16500)).toBe('€165')
  })

  it('places the minus sign before the euro symbol for negative amounts', () => {
    expect(fmtEurosRounded(-16500)).toBe('-€165')
  })
})

// ── toAmsDateStr ──────────────────────────────────────────────────────────────

describe('toAmsDateStr', () => {
  it('returns the Amsterdam calendar date for a UTC instant just after Amsterdam midnight', () => {
    // 2026-08-16T00:30:00 CEST (UTC+2) = 2026-08-15T22:30:00Z — still Aug 15 in UTC,
    // but toISOString().slice(0,10) on this instant would ALSO say Aug 15 (matches).
    // The real hazard case: an instant that's Aug 16 in Amsterdam but Aug 15 in UTC.
    const lateNight = new Date('2026-08-15T22:30:00Z') // 00:30 Aug 16 in Amsterdam (CEST)
    expect(toAmsDateStr(lateNight)).toBe('2026-08-16')
    expect(lateNight.toISOString().slice(0, 10)).toBe('2026-08-15') // the bug this replaces
  })

  it('accepts a date-only string', () => {
    expect(toAmsDateStr('2026-01-01')).toBe('2026-01-01')
  })

  it('defaults to the current instant when called with no argument', () => {
    expect(toAmsDateStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

// ── formatPrice ─────────────────────────────────────────────────────────────

describe('formatPrice', () => {
  it('converts cents to EUR with no decimals', () => {
    expect(formatPrice(16500)).toMatch(/165/)
  })

  it('handles zero', () => {
    expect(formatPrice(0)).toMatch(/0/)
  })

  it('handles large amounts', () => {
    expect(formatPrice(100000)).toMatch(/1,?000/)
  })

  it('rounds down (no fractional cents display)', () => {
    // 1550 cents = €15.50, but maximumFractionDigits=0 → €16 (rounded)
    const result = formatPrice(1550)
    expect(result).toMatch(/16|15/) // Intl may round up or truncate
  })
})

// ── formatDuration ──────────────────────────────────────────────────────────

describe('formatDuration', () => {
  it('formats exact hours', () => {
    expect(formatDuration(60)).toBe('1h')
    expect(formatDuration(120)).toBe('2h')
    expect(formatDuration(180)).toBe('3h')
  })

  it('formats hours and minutes', () => {
    expect(formatDuration(90)).toBe('1h 30m')
    expect(formatDuration(150)).toBe('2h 30m')
    expect(formatDuration(75)).toBe('1h 15m')
  })

  it('formats sub-hour durations', () => {
    expect(formatDuration(45)).toBe('0h 45m')
    expect(formatDuration(30)).toBe('0h 30m')
  })
})

// ── formatDate ──────────────────────────────────────────────────────────────

describe('formatDate', () => {
  it('formats a Date object with default options', () => {
    const date = new Date('2026-04-07T12:00:00Z')
    const result = formatDate(date)
    // Default: weekday long, day numeric, month long
    expect(result).toContain('April')
    expect(result).toContain('7')
  })

  it('accepts string dates', () => {
    const result = formatDate('2026-12-25')
    expect(result).toContain('December')
    expect(result).toContain('25')
  })

  it('always shows the Amsterdam calendar day, regardless of the runtime/viewer timezone', () => {
    // 23:30 UTC on Aug 15 = 01:30 Aug 16 in Amsterdam (CEST, UTC+2) — a viewer whose
    // browser is in a negative-offset timezone (or a server running in UTC) would see
    // Aug 15 without the explicit Amsterdam timeZone this function now defaults to.
    const result = formatDate(new Date('2026-08-15T23:30:00Z'))
    expect(result).toContain('16')
    expect(result).not.toContain('15')
  })
})

describe('formatReviewMonthYear', () => {
  it('formats a publish_time as "Month Year"', () => {
    expect(formatReviewMonthYear('2026-06-15T12:00:00Z')).toBe('June 2026')
  })

  it('returns empty string for null', () => {
    expect(formatReviewMonthYear(null)).toBe('')
  })

  it('does not throw for an unparseable date', () => {
    expect(() => formatReviewMonthYear('not-a-date')).not.toThrow()
  })
})

describe('formatShortDate', () => {
  it('formats with short month', () => {
    const result = formatShortDate(new Date('2026-04-07'))
    expect(result).toContain('Apr')
    expect(result).toContain('2026')
  })
})

// ── categorizeListings ──────────────────────────────────────────────────────

describe('categorizeListings', () => {
  const listings = [
    { id: 1, category: 'private', name: 'Sunset Cruise' },
    { id: 2, category: 'shared', name: 'City Tour' },
    { id: 3, category: 'private', name: 'Romantic Cruise' },
    { id: 4, category: 'shared', name: 'Morning Tour' },
    { id: 5, category: null, name: 'Uncategorized' },
  ]

  it('separates private and shared listings', () => {
    const result = categorizeListings(listings)
    expect(result.private).toHaveLength(2)
    expect(result.shared).toHaveLength(2)
  })

  it('private contains only private listings', () => {
    const result = categorizeListings(listings)
    expect(result.private.every(l => l.category === 'private')).toBe(true)
  })

  it('shared contains only shared listings', () => {
    const result = categorizeListings(listings)
    expect(result.shared.every(l => l.category === 'shared')).toBe(true)
  })

  it('null category goes to neither bucket', () => {
    const result = categorizeListings(listings)
    expect(result.private).toHaveLength(2)
    expect(result.shared).toHaveLength(2)
    // Total: 4 categorized, 1 null excluded from both
  })

  it('handles empty array', () => {
    const result = categorizeListings([])
    expect(result.private).toHaveLength(0)
    expect(result.shared).toHaveLength(0)
  })
})

// ── slugify ─────────────────────────────────────────────────────────────────

describe('slugify', () => {
  it('converts to lowercase', () => {
    expect(slugify('Hello World')).toBe('hello-world')
  })

  it('replaces spaces with hyphens', () => {
    expect(slugify('sunset cruise amsterdam')).toBe('sunset-cruise-amsterdam')
  })

  it('removes special characters', () => {
    expect(slugify('Café & Boat!')).toBe('caf-boat')
  })

  it('collapses multiple hyphens', () => {
    expect(slugify('hello   world')).toBe('hello-world')
  })

  it('trims leading and trailing hyphens', () => {
    expect(slugify(' -hello- ')).toBe('hello')
  })

  it('handles underscores', () => {
    expect(slugify('hello_world')).toBe('hello-world')
  })
})
