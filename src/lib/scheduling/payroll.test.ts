import { describe, it, expect } from 'vitest'
import {
  entryMinutes,
  entryPayCents,
  aggregatePayroll,
  formatMinutes,
  computeAutoCloseAt,
  type PayrollTimeEntry,
  type PayrollStaff,
} from './payroll'

function entry(over: Partial<PayrollTimeEntry> = {}): PayrollTimeEntry {
  return {
    id: 'e1',
    staff_id: 's1',
    clock_in_at: '2026-06-01T10:00:00.000Z',
    clock_out_at: '2026-06-01T12:00:00.000Z',
    hourly_rate_cents: 2000, // €20/h
    flag: null,
    ...over,
  }
}

describe('entryMinutes', () => {
  it('computes whole minutes for a closed entry', () => {
    expect(entryMinutes(entry())).toBe(120)
  })

  it('returns null for an open entry', () => {
    expect(entryMinutes(entry({ clock_out_at: null }))).toBeNull()
  })

  it('rounds to the nearest minute', () => {
    // 90 seconds = 1.5 min → rounds to 2
    expect(
      entryMinutes(entry({
        clock_in_at: '2026-06-01T10:00:00.000Z',
        clock_out_at: '2026-06-01T10:01:30.000Z',
      })),
    ).toBe(2)
  })

  it('returns 0 when clock_out is before clock_in (clock skew)', () => {
    expect(
      entryMinutes(entry({
        clock_in_at: '2026-06-01T12:00:00.000Z',
        clock_out_at: '2026-06-01T11:00:00.000Z',
      })),
    ).toBe(0)
  })
})

describe('entryPayCents', () => {
  it('pays rate × hours (2h @ €20 = €40)', () => {
    expect(entryPayCents(entry())).toBe(4000)
  })

  it('handles partial hours (90 min @ €20 = €30)', () => {
    expect(
      entryPayCents(entry({
        clock_in_at: '2026-06-01T10:00:00.000Z',
        clock_out_at: '2026-06-01T11:30:00.000Z',
      })),
    ).toBe(3000)
  })

  it('rounds to the nearest cent', () => {
    // 50 min @ €20/h = 16.666… → €16.67
    expect(
      entryPayCents(entry({
        clock_in_at: '2026-06-01T10:00:00.000Z',
        clock_out_at: '2026-06-01T10:50:00.000Z',
        hourly_rate_cents: 2000,
      })),
    ).toBe(1667)
  })

  it('pays nothing for an open entry', () => {
    expect(entryPayCents(entry({ clock_out_at: null }))).toBe(0)
  })

  it('uses the snapshot rate on the entry, not any current rate', () => {
    // Entry snapshotted at €25/h → 2h = €50 regardless of staff's rate today
    expect(entryPayCents(entry({ hourly_rate_cents: 2500 }))).toBe(5000)
  })
})

describe('aggregatePayroll', () => {
  const staff: PayrollStaff[] = [
    { id: 's1', name: 'Joris', role: 'skipper' },
    { id: 's2', name: 'Anouk', role: 'host' },
  ]

  it('groups entries per staff with totals', () => {
    const lines = aggregatePayroll(
      [
        entry({ id: 'a', staff_id: 's1' }), // 2h €40
        entry({ id: 'b', staff_id: 's1', clock_out_at: '2026-06-01T13:00:00.000Z' }), // 3h €60
      ],
      staff,
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      staffId: 's1',
      name: 'Joris',
      role: 'skipper',
      entryCount: 2,
      openCount: 0,
      flaggedCount: 0,
      totalMinutes: 300,
      totalPayCents: 10000,
    })
  })

  it('counts open entries separately and excludes them from pay', () => {
    const lines = aggregatePayroll(
      [
        entry({ id: 'a', staff_id: 's1' }), // closed 2h €40
        entry({ id: 'b', staff_id: 's1', clock_out_at: null }), // open
      ],
      staff,
    )
    expect(lines[0].entryCount).toBe(2)
    expect(lines[0].openCount).toBe(1)
    expect(lines[0].totalMinutes).toBe(120)
    expect(lines[0].totalPayCents).toBe(4000)
  })

  it('counts flagged entries', () => {
    const lines = aggregatePayroll(
      [
        entry({ id: 'a', staff_id: 's1', flag: 'auto_closed' }),
        entry({ id: 'b', staff_id: 's1', flag: null }),
      ],
      staff,
    )
    expect(lines[0].flaggedCount).toBe(1)
  })

  it('sorts lines by name', () => {
    const lines = aggregatePayroll(
      [
        entry({ id: 'a', staff_id: 's1' }), // Joris
        entry({ id: 'b', staff_id: 's2' }), // Anouk
      ],
      staff,
    )
    expect(lines.map(l => l.name)).toEqual(['Anouk', 'Joris'])
  })

  it('omits staff with no entries', () => {
    const lines = aggregatePayroll([entry({ staff_id: 's1' })], staff)
    expect(lines.map(l => l.staffId)).toEqual(['s1'])
  })

  it('falls back to Unknown for an entry whose staff is missing', () => {
    const lines = aggregatePayroll([entry({ staff_id: 'ghost' })], staff)
    expect(lines[0].name).toBe('Unknown')
    expect(lines[0].role).toBe('—')
  })

  it('returns empty for no entries', () => {
    expect(aggregatePayroll([], staff)).toEqual([])
  })
})

describe('formatMinutes', () => {
  it('formats hours and zero-padded minutes', () => {
    expect(formatMinutes(485)).toBe('8h 05m')
    expect(formatMinutes(120)).toBe('2h 00m')
    expect(formatMinutes(0)).toBe('0h 00m')
    expect(formatMinutes(59)).toBe('0h 59m')
  })
})

describe('computeAutoCloseAt', () => {
  const clockIn = '2026-06-01T10:00:00.000Z'

  it('closes at the matched shift end when reasonable', () => {
    const end = '2026-06-01T12:00:00.000Z'
    expect(computeAutoCloseAt(clockIn, end)).toBe('2026-06-01T12:00:00.000Z')
  })

  it('caps at maxHours when the shift runs longer than the cap', () => {
    const end = '2026-06-01T20:00:00.000Z' // 10h shift
    // default cap 4h → 14:00
    expect(computeAutoCloseAt(clockIn, end)).toBe('2026-06-01T14:00:00.000Z')
  })

  it('caps at maxHours past clock-in when there is no shift', () => {
    expect(computeAutoCloseAt(clockIn, null)).toBe('2026-06-01T14:00:00.000Z')
  })

  it('ignores a shift end that is before clock-in', () => {
    const end = '2026-06-01T09:00:00.000Z'
    expect(computeAutoCloseAt(clockIn, end)).toBe('2026-06-01T14:00:00.000Z')
  })

  it('respects a custom maxHours', () => {
    expect(computeAutoCloseAt(clockIn, null, 6)).toBe('2026-06-01T16:00:00.000Z')
  })
})
