import { describe, it, expect } from 'vitest'
import { scrollerStartDate, buildUpcomingDates } from './DateCardPicker'
import { toDateStr } from '@/lib/utils'

const today = new Date('2026-10-01T00:00:00')

describe('scrollerStartDate', () => {
  it('starts today when there is no minDate', () => {
    expect(toDateStr(scrollerStartDate(today))).toBe('2026-10-01')
  })
  it('starts on minDate when it is in the future', () => {
    expect(toDateStr(scrollerStartDate(today, '2026-11-26'))).toBe('2026-11-26')
  })
  it('ignores a minDate that has already passed or is today', () => {
    expect(toDateStr(scrollerStartDate(today, '2026-09-01'))).toBe('2026-10-01')
    expect(toDateStr(scrollerStartDate(today, '2026-10-01'))).toBe('2026-10-01')
  })
})

describe('buildUpcomingDates', () => {
  it('builds consecutive days from the start, across a month boundary', () => {
    const dates = buildUpcomingDates(7, new Date('2026-11-26T00:00:00'), today)
    expect(dates.map(d => d.dateStr)).toEqual(['2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02'])
  })
  it('only labels the real today as "today"', () => {
    expect(buildUpcomingDates(3, new Date('2026-11-26T00:00:00'), today).some(d => d.isToday)).toBe(false)
    expect(buildUpcomingDates(3, today, today).map(d => d.isToday)).toEqual([true, false, false])
  })
})
