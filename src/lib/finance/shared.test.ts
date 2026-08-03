import { describe, it, expect } from 'vitest'
import { parseCsvRows, toCents, splitVat } from './shared'

describe('toCents', () => {
  // Every format variant previously handled by a different, incompatible
  // per-source toCents — this replaces all of them, so it must accept every
  // format any of them accepted.
  it('parses a bare number (no currency symbol, no separators)', () => {
    expect(toCents('165')).toBe(16500)
    expect(toCents('165.50')).toBe(16550)
  })

  it('parses a comma-thousands-separated number', () => {
    expect(toCents('1,650.50')).toBe(165050)
  })

  it('strips a leading € symbol', () => {
    expect(toCents('€165.50')).toBe(16550)
  })

  it('strips surrounding/internal whitespace', () => {
    expect(toCents(' 165.50 ')).toBe(16550)
    expect(toCents('€ 165.50')).toBe(16550)
  })

  it('handles the combination: €, whitespace, AND thousands commas together', () => {
    expect(toCents('€ 1,650.50')).toBe(165050)
  })

  it('SECURITY: returns null (not a silent 0) for unparseable input — the exact bug this replaces', () => {
    // The old fareharbor-payout-csv/withlocals variants stripped € and commas
    // but NOT whitespace; other variants stripped nothing at all. Feeding any
    // of those a format they didn't expect used to silently return 0. This
    // canonical version accepts all known formats, but genuinely bad input
    // must still surface as null, not a fabricated zero.
    expect(toCents('not a number')).toBeNull()
    expect(toCents('')).toBeNull()
  })

  it('treats null/undefined as unparseable (null), not zero', () => {
    expect(toCents(null)).toBeNull()
    expect(toCents(undefined)).toBeNull()
  })

  it('accepts a numeric value directly', () => {
    expect(toCents(165.5)).toBe(16550)
  })

  it('rounds to the nearest cent', () => {
    expect(toCents('10.005')).toBe(1001) // 1000.5 rounds up
  })

  it('handles zero correctly (a real zero, not confused with unparseable)', () => {
    expect(toCents('0')).toBe(0)
    expect(toCents('0.00')).toBe(0)
  })
})

describe('parseCsvRows', () => {
  it('splits a simple CSV into rows of fields', () => {
    const rows = parseCsvRows('a,b,c\n1,2,3\n')
    expect(rows).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
  })

  it('honors double-quoted fields containing a comma', () => {
    const rows = parseCsvRows('name,amount\n"Smith, John",100\n')
    expect(rows).toEqual([['name', 'amount'], ['Smith, John', '100']])
  })

  it('handles an escaped "" quote inside a quoted field', () => {
    const rows = parseCsvRows('note\n"She said ""hi"""\n')
    expect(rows[1]).toEqual(['She said "hi"'])
  })

  it('SECURITY: a quoted field containing an embedded newline is NOT broken into two rows', () => {
    // The exact bug clickandboat-csv.ts had before migrating to this shared
    // parser — it split on newlines BEFORE parsing quotes, so this would have
    // corrupted the row.
    const rows = parseCsvRows('title,amount\n"Line one\nLine two",50\n')
    expect(rows).toEqual([['title', 'amount'], ['Line one\nLine two', '50']])
  })

  it('handles a file with no trailing newline', () => {
    const rows = parseCsvRows('a,b\n1,2')
    expect(rows).toEqual([['a', 'b'], ['1', '2']])
  })

  it('handles CRLF line endings', () => {
    const rows = parseCsvRows('a,b\r\n1,2\r\n')
    expect(rows).toEqual([['a', 'b'], ['1', '2']])
  })

  it('filters out fully-blank rows', () => {
    const rows = parseCsvRows('a,b\n1,2\n\n\n3,4\n')
    expect(rows).toEqual([['a', 'b'], ['1', '2'], ['3', '4']])
  })
})

describe('splitVat', () => {
  it('splits a gross amount into ex-VAT + VAT at the given rate', () => {
    const { exCents, vatCents } = splitVat(10900, 9) // €109.00 incl 9% VAT
    expect(exCents).toBe(10000)
    expect(vatCents).toBe(900)
  })

  it('ex + vat always sums back to the original gross (no rounding drift)', () => {
    const gross = 32000 // an amount that doesn't divide evenly
    const { exCents, vatCents } = splitVat(gross, 21)
    expect(exCents + vatCents).toBe(gross)
  })
})
