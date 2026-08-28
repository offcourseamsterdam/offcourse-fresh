import { describe, it, expect } from 'vitest'
import { cateringAutoSendCutoffDate, isWithinCateringAutoSendWindow, daysUntilCateringAutoSend } from './auto-send-cutoff'

describe('cateringAutoSendCutoffDate', () => {
  it('returns the date N days ahead, formatted as YYYY-MM-DD', () => {
    const now = new Date('2026-07-01T10:00:00Z')
    expect(cateringAutoSendCutoffDate(7, now)).toBe('2026-07-08')
  })

  it('returns today when daysAhead is 0', () => {
    const now = new Date('2026-07-01T10:00:00Z')
    expect(cateringAutoSendCutoffDate(0, now)).toBe('2026-07-01')
  })

  it('rolls over month boundaries correctly', () => {
    const now = new Date('2026-07-28T10:00:00Z')
    expect(cateringAutoSendCutoffDate(7, now)).toBe('2026-08-04')
  })

  it('rolls over year boundaries correctly', () => {
    const now = new Date('2026-12-28T10:00:00Z')
    expect(cateringAutoSendCutoffDate(7, now)).toBe('2027-01-04')
  })

  it('uses Amsterdam local time, not UTC, near midnight', () => {
    // 23:30 UTC on June 30th is already July 1st 01:30 in Amsterdam (CEST, UTC+2)
    const now = new Date('2026-06-30T23:30:00Z')
    expect(cateringAutoSendCutoffDate(7, now)).toBe('2026-07-08')
  })
})

describe('isWithinCateringAutoSendWindow', () => {
  const now = new Date('2026-07-01T10:00:00Z') // cutoff(7) = 2026-07-08

  it('is true for a departure exactly on the cutoff day', () => {
    expect(isWithinCateringAutoSendWindow('2026-07-08', 7, now)).toBe(true)
  })

  it('is true for a departure before the cutoff (last-minute booking)', () => {
    expect(isWithinCateringAutoSendWindow('2026-07-02', 7, now)).toBe(true)
  })

  it('is false for a departure after the cutoff (long-lead booking)', () => {
    expect(isWithinCateringAutoSendWindow('2026-07-09', 7, now)).toBe(false)
  })

  it('is false when there is no booking date', () => {
    expect(isWithinCateringAutoSendWindow(null, 7, now)).toBe(false)
    expect(isWithinCateringAutoSendWindow(undefined, 7, now)).toBe(false)
  })
})

describe('daysUntilCateringAutoSend', () => {
  const now = new Date('2026-07-01T10:00:00Z') // today (Amsterdam) = 2026-07-01

  it('counts down for a long-lead booking', () => {
    expect(daysUntilCateringAutoSend('2026-07-14', 7, now)).toBe(6)
  })

  it('is 0 exactly on the cutoff day', () => {
    expect(daysUntilCateringAutoSend('2026-07-08', 7, now)).toBe(0)
  })

  it('is negative once already inside the window', () => {
    expect(daysUntilCateringAutoSend('2026-07-02', 7, now)).toBe(-6)
  })

  it('is null when there is no booking date', () => {
    expect(daysUntilCateringAutoSend(null, 7, now)).toBeNull()
    expect(daysUntilCateringAutoSend(undefined, 7, now)).toBeNull()
  })

  it('rolls over month boundaries correctly', () => {
    const lateJuly = new Date('2026-07-28T10:00:00Z') // today = 2026-07-28
    expect(daysUntilCateringAutoSend('2026-08-10', 7, lateJuly)).toBe(6)
  })
})
