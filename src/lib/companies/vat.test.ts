import { describe, it, expect } from 'vitest'
import { parseVatInput } from './vat'

describe('parseVatInput', () => {
  it('parses valid Dutch VAT numbers with prefix', () => {
    expect(parseVatInput('NL867981374B01')).toEqual({
      countryCode: 'NL',
      vatNumber: '867981374B01',
    })
  })

  it('handles spaces and dots in Dutch VAT numbers', () => {
    expect(parseVatInput('nl 8679.81.374.B01')).toEqual({
      countryCode: 'NL',
      vatNumber: '867981374B01',
    })
  })

  it('infers NL if no country prefix matches 9 digits + B + 2 digits', () => {
    expect(parseVatInput('867981374B01')).toEqual({
      countryCode: 'NL',
      vatNumber: '867981374B01',
    })
  })

  it('parses German VAT numbers', () => {
    expect(parseVatInput('DE 123456789')).toEqual({
      countryCode: 'DE',
      vatNumber: '123456789',
    })
  })

  it('returns null for invalid inputs', () => {
    expect(parseVatInput('')).toBeNull()
    expect(parseVatInput('invalid')).toBeNull()
    expect(parseVatInput('ZZ123456789')).toBeNull()
  })
})
