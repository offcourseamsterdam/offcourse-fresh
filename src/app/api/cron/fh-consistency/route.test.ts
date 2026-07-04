import { describe, it, expect } from 'vitest'
import { consistencyDisplayDate } from './route'

/**
 * Pins the date-fallback that lets the consistency cron check bookings whose
 * booking_date is null but whose start_time holds the real departure — the rows
 * the old `.not('booking_date','is',null)` filter silently skipped.
 */
describe('consistencyDisplayDate', () => {
  it('uses booking_date when present', () => {
    expect(consistencyDisplayDate({ booking_date: '2026-07-01', start_time: '2026-07-01T18:00:00+02:00' }))
      .toBe('2026-07-01')
  })

  it('falls back to the date portion of start_time when booking_date is null', () => {
    expect(consistencyDisplayDate({ booking_date: null, start_time: '2026-07-01T18:00:00+02:00' }))
      .toBe('2026-07-01')
  })

  it('returns "?" only when both are missing', () => {
    expect(consistencyDisplayDate({ booking_date: null, start_time: null })).toBe('?')
  })
})
