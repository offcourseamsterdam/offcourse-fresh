import { describe, it, expect } from 'vitest'
import { checkAvailabilityRequest, getNextAvailabilityRequestDate } from './availability-request'

describe('checkAvailabilityRequest', () => {
  it('is null on an ordinary day', () => {
    expect(checkAvailabilityRequest(new Date('2026-08-08T10:00:00Z'))).toBeNull()
  })

  it('fires exactly 42 days before a month starts', () => {
    // October 1, 2026 minus 42 days = August 20, 2026.
    const result = checkAvailabilityRequest(new Date('2026-08-20T10:00:00Z'))
    expect(result).toEqual({ targetMonth: '2026-10', targetMonthStart: '2026-10-01' })
  })

  it('is null the day before or after the exact trigger date', () => {
    expect(checkAvailabilityRequest(new Date('2026-08-19T10:00:00Z'))).toBeNull()
    expect(checkAvailabilityRequest(new Date('2026-08-21T10:00:00Z'))).toBeNull()
  })

  it('rolls correctly across a year boundary', () => {
    // January 1, 2027 minus 42 days = November 20, 2026.
    const result = checkAvailabilityRequest(new Date('2026-11-20T10:00:00Z'))
    expect(result).toEqual({ targetMonth: '2027-01', targetMonthStart: '2027-01-01' })
  })

  it('uses Amsterdam local time, not UTC, near midnight', () => {
    // 23:30 UTC on Aug 19 is already Aug 20 00:30 in Amsterdam (CEST, UTC+2).
    const result = checkAvailabilityRequest(new Date('2026-08-19T23:30:00Z'))
    expect(result).toEqual({ targetMonth: '2026-10', targetMonthStart: '2026-10-01' })
  })
})

describe('getNextAvailabilityRequestDate', () => {
  it('finds the next upcoming trigger date from an ordinary day', () => {
    // From Aug 8, 2026 the next trigger is Aug 20 (for October).
    const result = getNextAvailabilityRequestDate(new Date('2026-08-08T10:00:00Z'))
    expect(result).toEqual({
      targetMonth: '2026-10',
      targetMonthStart: '2026-10-01',
      triggerDate: '2026-08-20',
      daysUntil: 12,
    })
  })

  it('returns daysUntil: 0 exactly on the trigger date itself', () => {
    const result = getNextAvailabilityRequestDate(new Date('2026-08-20T10:00:00Z'))
    expect(result.daysUntil).toBe(0)
    expect(result.triggerDate).toBe('2026-08-20')
  })

  it('moves on to the following month once the current trigger date has passed', () => {
    // The day after the Aug 20 (October) trigger — next one is for November.
    const result = getNextAvailabilityRequestDate(new Date('2026-08-21T10:00:00Z'))
    expect(result.targetMonth).toBe('2026-11')
  })
})
