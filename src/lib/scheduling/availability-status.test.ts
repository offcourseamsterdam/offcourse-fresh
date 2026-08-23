import { describe, it, expect, vi } from 'vitest'
import {
  monthRange,
  getMonthAvailabilityStatus,
  getMonthAvailabilityGrid,
  captainAvailabilityUrl,
  availabilityDisplay,
  AVAILABILITY_TAP_CYCLE,
} from './availability-status'

describe('monthRange', () => {
  it('covers the whole month, whatever its length', () => {
    expect(monthRange('2026-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(monthRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' })
  })

  it('gets February right in both a common and a leap year', () => {
    expect(monthRange('2026-02').to).toBe('2026-02-28')
    expect(monthRange('2028-02').to).toBe('2028-02-29')
  })
})

describe('captainAvailabilityUrl', () => {
  it('builds a real, absolute link to the captain calendar', () => {
    expect(captainAvailabilityUrl('https://offcourseamsterdam.com')).toBe(
      'https://offcourseamsterdam.com/en/captain/availability',
    )
  })

  it('does not double up the slash when the site URL has a trailing one', () => {
    expect(captainAvailabilityUrl('https://offcourseamsterdam.com/')).toBe(
      'https://offcourseamsterdam.com/en/captain/availability',
    )
  })
})

/** Two-query stub: active staff, then that month's availability rows. */
function makeSupabase(staff: unknown[], availability: { staff_id: string }[]) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'staff') {
        return { select: () => ({ eq: () => ({ order: async () => ({ data: staff }) }) }) }
      }
      return { select: () => ({ gte: () => ({ lte: async () => ({ data: availability }) }) }) }
    }),
  } as never
}

describe('getMonthAvailabilityStatus', () => {
  const bas = { id: 'bas', name: 'Bas', slack_member_id: 'U-bas', slack_notifications_enabled: true }
  const mare = { id: 'mare', name: 'Mare', slack_member_id: null, slack_notifications_enabled: null }
  const jannah = { id: 'jannah', name: 'Jannah', slack_member_id: 'U-j', slack_notifications_enabled: false }

  it('counts the days each captain actually marked', async () => {
    const rows = await getMonthAvailabilityStatus(
      makeSupabase([bas, mare], [{ staff_id: 'bas' }, { staff_id: 'bas' }, { staff_id: 'bas' }]),
      '2026-10',
    )

    expect(rows.find(r => r.staffId === 'bas')).toMatchObject({ daysFilled: 3, hasResponded: true })
    expect(rows.find(r => r.staffId === 'mare')).toMatchObject({ daysFilled: 0, hasResponded: false })
  })

  it('treats even a single marked day as a response — one deliberate tap is engagement, and we do not nag for a fully-completed month', async () => {
    const rows = await getMonthAvailabilityStatus(makeSupabase([bas], [{ staff_id: 'bas' }]), '2026-10')
    expect(rows[0]).toMatchObject({ daysFilled: 1, hasResponded: true })
  })

  it('only an explicit false counts as notifications-off — a null column still gets messaged', async () => {
    const rows = await getMonthAvailabilityStatus(makeSupabase([bas, mare, jannah], []), '2026-10')

    expect(rows.find(r => r.staffId === 'bas')!.slackNotificationsEnabled).toBe(true)
    expect(rows.find(r => r.staffId === 'mare')!.slackNotificationsEnabled).toBe(true) // null → still on
    expect(rows.find(r => r.staffId === 'jannah')!.slackNotificationsEnabled).toBe(false)
  })

  it('survives empty tables without throwing', async () => {
    expect(await getMonthAvailabilityStatus(makeSupabase([], []), '2026-10')).toEqual([])
  })
})

/** Single-query stub for the grid — only staff_availability, no staff table. */
function makeGridSupabase(
  rows: { staff_id: string; date: string; status: string; start_time?: string | null; end_time?: string | null }[],
) {
  return {
    from: () => ({ select: () => ({ gte: () => ({ lte: async () => ({ data: rows }) }) }) }),
  } as never
}

describe('getMonthAvailabilityGrid — the day-by-day, everyone-at-once view (Beer, 2026-08-23)', () => {
  it('returns every day of the month, even ones nobody marked', async () => {
    const grid = await getMonthAvailabilityGrid(makeGridSupabase([]), '2026-09')
    expect(grid).toHaveLength(30) // September
    expect(grid[0]).toEqual({ date: '2026-09-01', byStaffId: {} })
    expect(grid[29]).toEqual({ date: '2026-09-30', byStaffId: {} })
  })

  it('places each captain\'s status on the right day, multiple captains per day, hours trimmed to HH:MM', async () => {
    const grid = await getMonthAvailabilityGrid(
      makeGridSupabase([
        { staff_id: 'bas', date: '2026-09-15', status: 'available', start_time: '10:00:00', end_time: '18:00:00' },
        { staff_id: 'mare', date: '2026-09-15', status: 'unavailable' },
      ]),
      '2026-09',
    )

    const day15 = grid.find(d => d.date === '2026-09-15')!
    expect(day15.byStaffId).toEqual({
      bas: { status: 'available', startTime: '10:00', endTime: '18:00' },
      mare: { status: 'unavailable', startTime: null, endTime: null },
    })
  })

  it('drops a row with an unrecognized status rather than showing bad data — covers legacy \'prefer_not\' rows too, now that the status was removed', async () => {
    const madeUp = await getMonthAvailabilityGrid(
      makeGridSupabase([{ staff_id: 'bas', date: '2026-09-15', status: 'made_up_value' }]),
      '2026-09',
    )
    expect(madeUp.find(d => d.date === '2026-09-15')!.byStaffId).toEqual({})

    const legacy = await getMonthAvailabilityGrid(
      makeGridSupabase([{ staff_id: 'bas', date: '2026-09-15', status: 'prefer_not' }]),
      '2026-09',
    )
    expect(legacy.find(d => d.date === '2026-09-15')!.byStaffId).toEqual({})
  })
})

describe('availabilityDisplay', () => {
  it('reads no entry as unset', () => {
    expect(availabilityDisplay(undefined)).toBe('unset')
    expect(availabilityDisplay(null)).toBe('unset')
  })

  it('reads available with no hours as plain available', () => {
    expect(availabilityDisplay({ status: 'available', startTime: null, endTime: null })).toBe('available')
  })

  it('reads available WITH hours as partly available (Beer, 2026-08-23: "available, or partly available")', () => {
    expect(availabilityDisplay({ status: 'available', startTime: '10:00', endTime: '18:00' })).toBe('partly_available')
  })

  it('reads unavailable as unavailable even if hours are somehow set', () => {
    expect(availabilityDisplay({ status: 'unavailable', startTime: '10:00', endTime: '18:00' })).toBe('unavailable')
  })
})

describe('AVAILABILITY_TAP_CYCLE', () => {
  it('cycles unset -> available -> unavailable -> unset, terminating in null (not looping back on its own)', () => {
    expect(AVAILABILITY_TAP_CYCLE.unset).toBe('available')
    expect(AVAILABILITY_TAP_CYCLE.available).toBe('unavailable')
    expect(AVAILABILITY_TAP_CYCLE.unavailable).toBeNull()
  })
})
