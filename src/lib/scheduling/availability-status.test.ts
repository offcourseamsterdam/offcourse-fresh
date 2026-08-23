import { describe, it, expect, vi } from 'vitest'
import { monthRange, getMonthAvailabilityStatus, captainAvailabilityUrl } from './availability-status'

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
