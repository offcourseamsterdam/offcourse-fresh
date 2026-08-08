import { describe, it, expect } from 'vitest'
import { isScheduleDigestTime, buildCaptainDigests, formatDigestMessage, getNextScheduleDigestAt } from './schedule-digest'

describe('isScheduleDigestTime', () => {
  it('is true right at 18:00 Amsterdam (CEST, summer)', () => {
    // 16:00 UTC = 18:00 Amsterdam in August (CEST, UTC+2)
    expect(isScheduleDigestTime(new Date('2026-08-08T16:00:00Z'))).toBe(true)
  })

  it('is true up to 18:14 Amsterdam, false at 18:15', () => {
    expect(isScheduleDigestTime(new Date('2026-08-08T16:14:00Z'))).toBe(true)
    expect(isScheduleDigestTime(new Date('2026-08-08T16:15:00Z'))).toBe(false)
  })

  it('is false at 17:00 or 19:00 Amsterdam', () => {
    expect(isScheduleDigestTime(new Date('2026-08-08T15:00:00Z'))).toBe(false)
    expect(isScheduleDigestTime(new Date('2026-08-08T17:00:00Z'))).toBe(false)
  })

  it('correctly shifts by an hour in winter (CET, UTC+1) — the exact bug this avoids', () => {
    // 17:00 UTC in January is 18:00 Amsterdam (CET, UTC+1) — a fixed-UTC cron
    // tuned for summer would fire an hour late here; this stays correct.
    expect(isScheduleDigestTime(new Date('2026-01-08T17:00:00Z'))).toBe(true)
    expect(isScheduleDigestTime(new Date('2026-01-08T16:00:00Z'))).toBe(false)
  })
})

describe('getNextScheduleDigestAt', () => {
  it('points at today 18:00 Amsterdam when that has not passed yet', () => {
    // 10:00 UTC = 12:00 Amsterdam (CEST) — well before 18:00
    const result = getNextScheduleDigestAt(new Date('2026-08-08T10:00:00Z'))
    expect(result).toBe('2026-08-08T16:00:00.000Z') // 18:00 Amsterdam = 16:00 UTC in summer
  })

  it('points at tomorrow 18:00 Amsterdam once today\'s window has passed', () => {
    const result = getNextScheduleDigestAt(new Date('2026-08-08T17:00:00Z')) // 19:00 Amsterdam already
    expect(result).toBe('2026-08-09T16:00:00.000Z')
  })
})

describe('buildCaptainDigests', () => {
  const shift = (overrides: Partial<Parameters<typeof buildCaptainDigests>[0][number]> = {}) => ({
    staff_id: 'staff-1',
    start_at: '2026-08-09T13:00:00Z',
    end_at: '2026-08-09T15:00:00Z',
    staff: { name: 'Beer Zoomers', slack_member_id: 'U123' },
    boats: { name: 'Diana' },
    ...overrides,
  })

  it('groups shifts by captain', () => {
    const result = buildCaptainDigests([
      shift(),
      shift({ staff_id: 'staff-2', staff: { name: 'Jannah Schenk', slack_member_id: 'U456' } }),
    ])
    expect(result).toHaveLength(2)
    expect(result.find(d => d.staffId === 'staff-1')?.staffName).toBe('Beer Zoomers')
  })

  it('sorts a captain\'s shifts by start time', () => {
    const result = buildCaptainDigests([
      shift({ start_at: '2026-08-09T17:00:00Z', end_at: '2026-08-09T18:00:00Z' }),
      shift({ start_at: '2026-08-09T13:00:00Z', end_at: '2026-08-09T14:00:00Z' }),
    ])
    expect(result[0].shifts.map(s => s.startAt)).toEqual(['2026-08-09T13:00:00Z', '2026-08-09T17:00:00Z'])
  })

  it('skips a shift with no assigned staff', () => {
    const result = buildCaptainDigests([shift({ staff_id: null, staff: null })])
    expect(result).toHaveLength(0)
  })
})

describe('formatDigestMessage', () => {
  it('lists each shift on its own line with time and boat', () => {
    const msg = formatDigestMessage('Sun 9 Aug', [
      { startAt: '2026-08-09T13:00:00Z', endAt: '2026-08-09T15:00:00Z', boatName: 'Diana' },
    ])
    expect(msg).toContain('Tomorrow (Sun 9 Aug): 1 tour')
    expect(msg).toContain('Diana')
  })

  it('pluralizes correctly for more than one tour', () => {
    const msg = formatDigestMessage('Sun 9 Aug', [
      { startAt: '2026-08-09T13:00:00Z', endAt: '2026-08-09T15:00:00Z', boatName: 'Diana' },
      { startAt: '2026-08-09T17:00:00Z', endAt: '2026-08-09T18:30:00Z', boatName: 'Curaçao' },
    ])
    expect(msg).toContain('2 tours')
  })
})
