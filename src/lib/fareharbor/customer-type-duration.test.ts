import { describe, it, expect } from 'vitest'
import { parseDurationMinutesFromCustomerTypeName } from './customer-type-duration'

describe('parseDurationMinutesFromCustomerTypeName', () => {
  it('parses whole-hour durations', () => {
    expect(parseDurationMinutesFromCustomerTypeName('Diana - 2 Hours')).toBe(120)
    expect(parseDurationMinutesFromCustomerTypeName('Curaçao - 3 Hours')).toBe(180)
  })

  it('parses fractional-hour durations', () => {
    expect(parseDurationMinutesFromCustomerTypeName('Diana - 1.5 Hours')).toBe(90)
    expect(parseDurationMinutesFromCustomerTypeName('Curaçao - 1.5 Hours')).toBe(90)
  })

  it('is case-insensitive and tolerates singular "Hour"', () => {
    expect(parseDurationMinutesFromCustomerTypeName('diana - 1 hour')).toBe(60)
  })

  it('returns null for a shared customer type with no duration in the name', () => {
    expect(parseDurationMinutesFromCustomerTypeName('Adult (13+)')).toBeNull()
    expect(parseDurationMinutesFromCustomerTypeName('Child (0-12)')).toBeNull()
  })

  it('returns null for null/undefined/empty input', () => {
    expect(parseDurationMinutesFromCustomerTypeName(null)).toBeNull()
    expect(parseDurationMinutesFromCustomerTypeName(undefined)).toBeNull()
    expect(parseDurationMinutesFromCustomerTypeName('')).toBeNull()
  })

  it('returns null for a malformed/zero duration', () => {
    expect(parseDurationMinutesFromCustomerTypeName('Diana - 0 Hours')).toBeNull()
  })
})
