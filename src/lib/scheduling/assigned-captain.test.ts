import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getCaptainFirstNames } from './assigned-captain'

const state = vi.hoisted(() => ({
  ownShifts: [] as { booking_id: string; staff_id: string }[],
  sharedShifts: [] as { fareharbor_availability_pk: number; staff_id: string }[],
  staffRows: [] as { id: string; name: string }[],
}))

function makeSupabase() {
  return {
    from: (table: string) => {
      if (table === 'shifts') {
        return {
          select: (fields: string) => {
            if (fields.includes('booking_id')) {
              return { in: () => ({ not: () => Promise.resolve({ data: state.ownShifts }) }) }
            }
            return { in: () => ({ not: () => Promise.resolve({ data: state.sharedShifts }) }) }
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
    state.ownShifts = []
    state.sharedShifts = []
    state.staffRows = []
  })

  it('resolves a captain from the booking\'s own shift row', async () => {
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

  it('prefers the booking\'s own shift over the shared-slot fallback', async () => {
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
})
