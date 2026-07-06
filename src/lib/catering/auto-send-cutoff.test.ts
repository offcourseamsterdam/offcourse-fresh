import { describe, it, expect } from 'vitest'
import { cateringAutoSendCutoffDate } from './auto-send-cutoff'

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
