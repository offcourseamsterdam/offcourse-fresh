import { describe, it, expect } from 'vitest'
import { selectAllowedCustomerTypes, formatRatePrice } from './customer-types'

const RAW = [
  { name: 'Diana 1.5h', customer_type_pk: 1, price_cents: 31000 },
  { name: 'Diana 2h', customer_type_pk: 2, price_cents: 40000 },
  { name: 'Curaçao 1.5h', customer_type_pk: 3, price_cents: 31500 },
]

describe('selectAllowedCustomerTypes', () => {
  it('returns only the customer types in the allow-list', () => {
    expect(selectAllowedCustomerTypes(RAW, [1, 3])).toEqual([RAW[0], RAW[2]])
  })

  it('returns every type when the allow-list is null (no Layer 2 restriction)', () => {
    expect(selectAllowedCustomerTypes(RAW, null)).toEqual(RAW)
  })

  it('returns every type when the allow-list is undefined', () => {
    expect(selectAllowedCustomerTypes(RAW, undefined)).toEqual(RAW)
  })

  it('returns every type when the allow-list is empty', () => {
    expect(selectAllowedCustomerTypes(RAW, [])).toEqual(RAW)
  })

  it('returns an empty array when nothing matches', () => {
    expect(selectAllowedCustomerTypes(RAW, [999])).toEqual([])
  })
})

describe('formatRatePrice', () => {
  it('formats whole-euro cent amounts without decimals', () => {
    expect(formatRatePrice(31000)).toBe('€310')
  })

  it('keeps decimals for non-whole amounts', () => {
    expect(formatRatePrice(31050)).toBe('€310.50')
  })

  it('falls back to "Price on request" for null', () => {
    expect(formatRatePrice(null)).toBe('Price on request')
  })

  it('formats zero as €0', () => {
    expect(formatRatePrice(0)).toBe('€0')
  })
})
