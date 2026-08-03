import { describe, it, expect } from 'vitest'
import {
  amsterdamMinutesSinceMidnight,
  topPx,
  blockMinHeightPx,
  hourMarks,
  GRID_START_HOUR,
  GRID_END_HOUR,
  GRID_HEIGHT_PX,
  MIN_BLOCK_PX,
  PX_PER_HOUR,
} from './planning-time-grid'

describe('amsterdamMinutesSinceMidnight', () => {
  it('converts a UTC instant to Amsterdam-local minutes-since-midnight (CEST, summer)', () => {
    // 12:00 UTC in July = 14:00 Amsterdam (CEST, UTC+2) = 14*60 = 840
    expect(amsterdamMinutesSinceMidnight('2026-07-09T12:00:00Z')).toBe(840)
  })

  it('handles midnight correctly', () => {
    // 22:00 UTC in July = 00:00 Amsterdam the next day = 0
    expect(amsterdamMinutesSinceMidnight('2026-07-09T22:00:00Z')).toBe(0)
  })
})

describe('topPx', () => {
  it('positions 09:00 at the very top of the grid', () => {
    // 07:00 UTC = 09:00 Amsterdam (CEST)
    expect(topPx('2026-07-09T07:00:00Z')).toBe(0)
  })

  it('positions 14:00 Amsterdam at 5 hours * 60px = 300px', () => {
    // 12:00 UTC = 14:00 Amsterdam (CEST)
    expect(topPx('2026-07-09T12:00:00Z')).toBe(300)
  })

  it('positions 15:30 Amsterdam at 6.5 hours * 60px = 390px (Enrico\'s real booking)', () => {
    expect(topPx('2026-07-09T13:30:00Z')).toBe(390)
  })

  it('clamps a time before the grid start (defensive, should not happen in practice)', () => {
    // 06:00 UTC = 08:00 Amsterdam — before the 09:00 grid start
    expect(topPx('2026-07-09T06:00:00Z')).toBe(0)
  })

  it('positions a late-evening departure near the bottom of the grid', () => {
    // 21:30 UTC = 23:30 Amsterdam (CEST) -> (23.5 - 9) * 60 = 870px
    expect(topPx('2026-07-09T21:30:00Z')).toBe(870)
  })

  // Exact midnight (00:00) is a genuine ambiguity this function doesn't try to
  // resolve: amsterdamMinutesSinceMidnight('...T22:00:00Z') (= 00:00 Amsterdam)
  // returns 0, which reads as "start of day" and clamps to the TOP of the grid
  // — even though, if such a booking were ever bucketed into "today"'s column,
  // a reader would expect it at the BOTTOM (end of day). Not resolved because
  // this business has no departures anywhere near midnight in practice.

  it('returns 0 for a null start time', () => {
    expect(topPx(null)).toBe(0)
  })
})

describe('blockMinHeightPx', () => {
  it('returns the real duration in px when it exceeds the floor', () => {
    // 2-hour cruise = 120 minutes = 120px, well above the 44px floor
    expect(blockMinHeightPx('2026-07-09T12:00:00Z', '2026-07-09T14:00:00Z')).toBe(120)
  })

  it('floors a short duration at MIN_BLOCK_PX so text never gets compressed', () => {
    // 15-minute gap would be 15px — floored to MIN_BLOCK_PX
    expect(blockMinHeightPx('2026-07-09T12:00:00Z', '2026-07-09T12:15:00Z')).toBe(MIN_BLOCK_PX)
  })

  it('returns MIN_BLOCK_PX when start or end time is missing', () => {
    expect(blockMinHeightPx(null, '2026-07-09T14:00:00Z')).toBe(MIN_BLOCK_PX)
    expect(blockMinHeightPx('2026-07-09T12:00:00Z', null)).toBe(MIN_BLOCK_PX)
  })

  it('handles an end time that appears to cross midnight without going negative', () => {
    // 23:00 -> 00:30 next day (Amsterdam-local wall clock wraps)
    expect(blockMinHeightPx('2026-07-09T21:00:00Z', '2026-07-09T22:30:00Z')).toBeGreaterThan(0)
  })
})

describe('hourMarks', () => {
  it('returns one mark per hour from 09:00 through 24:00 inclusive', () => {
    const marks = hourMarks()
    expect(marks).toHaveLength(GRID_END_HOUR - GRID_START_HOUR + 1)
    expect(marks[0]).toEqual({ hour: 9, topPx: 0, label: '09:00' })
    expect(marks[marks.length - 1].hour).toBe(24)
  })

  it('labels the final mark "00:00", not "24:00" — clearer to a reader', () => {
    const marks = hourMarks()
    expect(marks[marks.length - 1].label).toBe('00:00')
    expect(marks[marks.length - 1].topPx).toBe(GRID_HEIGHT_PX)
  })

  it('spaces marks PX_PER_HOUR apart', () => {
    const marks = hourMarks()
    for (let i = 1; i < marks.length; i++) {
      expect(marks[i].topPx - marks[i - 1].topPx).toBe(PX_PER_HOUR)
    }
  })
})
