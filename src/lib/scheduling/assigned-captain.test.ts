import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getCaptainFirstNames } from './assigned-captain'

const state = vi.hoisted(() => ({
  siblingBookings: [] as { id: string; fareharbor_availability_pk: number }[],
  shiftBookings: [] as { booking_id: string; shift_id: string }[],
  ownShifts: [] as { booking_id: string; staff_id: string }[],
  sharedShifts: [] as { fareharbor_availability_pk: number; staff_id: string }[],
  shifts: [] as { id: string; staff_id: string }[],
  staffRows: [] as { id: string; name: string }[],
}))

function makeSupabase() {
  return {
    from: (table: string) => {
      if (table === 'bookings') {
        return { select: () => ({ in: () => Promise.resolve({ data: state.siblingBookings }) }) }
      }
      if (table === 'shift_bookings') {
        return { select: () => ({ in: () => Promise.resolve({ data: state.shiftBookings }) }) }
      }
      if (table === 'shifts') {
        return {
          select: (fields: string) => {
            if (fields.includes('booking_id')) {
              return { in: () => ({ not: () => Promise.resolve({ data: state.ownShifts }) }) }
            }
            if (fields.includes('fareharbor_availability_pk')) {
              return { in: () => ({ not: () => Promise.resolve({ data: state.sharedShifts }) }) }
            }
            // id, staff_id lookup (resolving shift_bookings -> staff)
            return { in: () => ({ not: () => Promise.resolve({ data: state.shifts }) }) }
          },
        }
      }
      if (table === 'staff') {
        return { select: () => ({ in: () => Promise.resolve({ data: state.staffRows }) }) }
      }
      throw new Error(`unexpected table "${table}"`)
      // eslint-disable-next-line no-unreachable
    },
  } as any
}

describe('getCaptainFirstNames', () => {
  beforeEach(() => {
    state.siblingBookings = []
    state.shiftBookings = []
    state.ownShifts = []
    state.sharedShifts = []
    state.shifts = []
    state.staffRows = []
  })

  it('resolves a captain via a direct shift_bookings link', async () => {
    state.shiftBookings = [{ booking_id: 'b1', shift_id: 'sh1' }]
    state.shifts = [{ id: 'sh1', staff_id: 's1' }]
    state.staffRows = [{ id: 's1', name: 'Beer Zoomers' }]

    const result = await getCaptainFirstNames(makeSupabase(), [
      { id: 'b1', fareharbor_availability_pk: null },
    ])

    expect(result.get('b1')).toBe('Beer')
  })

  it('resolves a captain from the booking\'s own legacy shifts.booking_id row', async () => {
    state.ownShifts = [{ booking_id: 'b1', staff_id: 's1' }]
    state.staffRows = [{ id: 's1', name: 'Beer Zoomers' }]

    const result = await getCaptainFirstNames(makeSupabase(), [
      { id: 'b1', fareharbor_availability_pk: null },
    ])

    expect(result.get('b1')).toBe('Beer')
  })

  it('falls back to a shared-cruise shift on the same availability slot', async () => {
    state.sharedShifts = [{ fareharbor_availability_pk: 555, staff_id: 's2' }]
    state.staffRows = [{ id: 's2', name: 'Jannah Schenk' }]

    const result = await getCaptainFirstNames(makeSupabase(), [
      { id: 'b2', fareharbor_availability_pk: 555 },
    ])

    expect(result.get('b2')).toBe('Jannah')
  })

  it('prefers a direct link over the shared-slot fallback', async () => {
    state.ownShifts = [{ booking_id: 'b3', staff_id: 's1' }]
    state.sharedShifts = [{ fareharbor_availability_pk: 555, staff_id: 's2' }]
    state.staffRows = [
      { id: 's1', name: 'Beer Zoomers' },
      { id: 's2', name: 'Jannah Schenk' },
    ]

    const result = await getCaptainFirstNames(makeSupabase(), [
      { id: 'b3', fareharbor_availability_pk: 555 },
    ])

    expect(result.get('b3')).toBe('Beer')
  })

  it('omits bookings with no resolvable captain', async () => {
    const result = await getCaptainFirstNames(makeSupabase(), [
      { id: 'b4', fareharbor_availability_pk: null },
    ])

    expect(result.has('b4')).toBe(false)
  })

  it('returns an empty map for an empty input without querying', async () => {
    const supabase = makeSupabase()
    const fromSpy = vi.spyOn(supabase, 'from')

    const result = await getCaptainFirstNames(supabase, [])

    expect(result.size).toBe(0)
    expect(fromSpy).not.toHaveBeenCalled()
  })

  it('resolves multiple bookings sharing the same captain', async () => {
    state.ownShifts = [
      { booking_id: 'b5', staff_id: 's1' },
      { booking_id: 'b6', staff_id: 's1' },
    ]
    state.staffRows = [{ id: 's1', name: 'Bas' }]

    const result = await getCaptainFirstNames(makeSupabase(), [
      { id: 'b5', fareharbor_availability_pk: null },
      { id: 'b6', fareharbor_availability_pk: null },
    ])

    expect(result.get('b5')).toBe('Bas')
    expect(result.get('b6')).toBe('Bas')
  })

  // Regression: a captain's shift block covered a private cruise immediately
  // followed by a shared cruise (real case, 2026-08-26). The shift's
  // shift_bookings only linked ONE of the three shared-cruise guests — the
  // other two must resolve via that linked sibling, not just come up empty.
  it('resolves a shared-cruise booking via a sibling booking that IS directly linked', async () => {
    // Sophie (b_sophie) is directly linked via shift_bookings; William and
    // Karl (b_william, b_karl) share the same availability_pk but have no
    // shift_bookings row of their own — same real-world shape as the bug.
    state.siblingBookings = [
      { id: 'b_sophie', fareharbor_availability_pk: 2010496442 },
      { id: 'b_william', fareharbor_availability_pk: 2010496442 },
      { id: 'b_karl', fareharbor_availability_pk: 2010496442 },
    ]
    state.shiftBookings = [
      { booking_id: 'b_gurkan', shift_id: 'sh1' }, // the private cruise booking
      { booking_id: 'b_sophie', shift_id: 'sh1' },  // one shared-cruise guest
    ]
    state.shifts = [{ id: 'sh1', staff_id: 's1' }]
    state.staffRows = [{ id: 's1', name: 'Beer Zoomers' }]

    const result = await getCaptainFirstNames(makeSupabase(), [
      { id: 'b_william', fareharbor_availability_pk: 2010496442 },
      { id: 'b_karl', fareharbor_availability_pk: 2010496442 },
    ])

    expect(result.get('b_william')).toBe('Beer')
    expect(result.get('b_karl')).toBe('Beer')
  })
})
