import { describe, it, expect } from 'vitest'
import { isValidIban, normalizeIban } from './iban'

describe('normalizeIban', () => {
  it('strips spaces and upper-cases', () => {
    expect(normalizeIban(' nl91 abna 0417 1643 00 ')).toBe('NL91ABNA0417164300')
  })
})

describe('isValidIban', () => {
  it.each([
    'NL91ABNA0417164300', // the ISO example everyone uses — Dutch, like our skippers
    'DE89370400440532013000',
    'GB82WEST12345698765432',
    'BE68539007547034',
    'nl91 abna 0417 1643 00', // pasted with spaces and lower-case
  ])('accepts a valid IBAN: %s', iban => {
    expect(isValidIban(iban)).toBe(true)
  })

  it('rejects a single-digit slip (the mod-97 case this exists for)', () => {
    expect(isValidIban('NL91ABNA0417164301')).toBe(false)
  })

  it('rejects two transposed digits', () => {
    expect(isValidIban('NL91ABNA0417164030')).toBe(false)
  })

  it.each([
    '',
    'NL91',
    'NL91ABNA', // too short for any country
    '1234567890123456', // no country code
    'NL9!ABNA0417164300', // punctuation
    'Niet gevonden', // what a failed extraction renders as — must never reach Revolut
  ])('rejects a malformed value: %j', iban => {
    expect(isValidIban(iban)).toBe(false)
  })
})
