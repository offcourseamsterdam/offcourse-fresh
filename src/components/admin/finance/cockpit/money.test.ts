import { describe, it, expect } from 'vitest'
import { eur, eurCents, pct, dateNL, eurosToCents, centsToEuros } from './money'

describe('eur', () => {
  it('formats whole euros with nl-NL grouping', () => {
    expect(eur(5248000)).toBe('€ 52.480')
    expect(eur(0)).toBe('€ 0')
    expect(eur(99)).toBe('€ 1')
    expect(eur(49)).toBe('€ 0')
  })
  it('keeps a leading minus for negatives', () => {
    expect(eur(-120000)).toBe('-€ 1.200')
  })
  it('returns a dash for missing values', () => {
    expect(eur(null)).toBe('—')
    expect(eur(undefined)).toBe('—')
    expect(eur(Number.NaN)).toBe('—')
  })
})

describe('eurCents', () => {
  it('formats with two decimals', () => {
    expect(eurCents(123456)).toBe('€ 1.234,56')
    expect(eurCents(-5)).toBe('-€ 0,05')
  })
})

describe('pct', () => {
  it('rounds and clamps', () => {
    expect(pct(42.4)).toBe('42%')
    expect(pct(130)).toBe('100%')
    expect(pct(-3)).toBe('0%')
    expect(pct(130, false)).toBe('130%')
    expect(pct(null)).toBe('—')
  })
})

describe('dateNL', () => {
  it('turns ISO dates into dd-mm-yyyy', () => {
    expect(dateNL('2026-10-01')).toBe('01-10-2026')
    expect(dateNL('2026-10-01T12:00:00Z')).toBe('01-10-2026')
    expect(dateNL(null)).toBe('—')
    expect(dateNL('')).toBe('—')
  })
})

describe('eurosToCents / centsToEuros', () => {
  it('parses Dutch and English decimal notation', () => {
    expect(eurosToCents('1234,56')).toBe(123456)
    expect(eurosToCents('1.234,56')).toBe(123456)
    expect(eurosToCents('1234.56')).toBe(123456)
    expect(eurosToCents('€ 200')).toBe(20000)
    expect(eurosToCents(12.3)).toBe(1230)
  })
  it('distinguishes blank from zero', () => {
    expect(eurosToCents('')).toBeNull()
    expect(eurosToCents('   ')).toBeNull()
    expect(eurosToCents('abc')).toBeNull()
    expect(eurosToCents('0')).toBe(0)
    expect(eurosToCents(null)).toBeNull()
  })
  it('avoids float drift', () => {
    expect(eurosToCents('0.29')).toBe(29)
    expect(eurosToCents('1.005')).toBe(101)
  })
  it('round-trips to a form value', () => {
    expect(centsToEuros(123456)).toBe('1234.56')
    expect(centsToEuros(20000)).toBe('200')
    expect(centsToEuros(null)).toBe('')
  })
})
