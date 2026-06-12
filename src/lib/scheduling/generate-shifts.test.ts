import { describe, it, expect } from 'vitest'
import {
  generateShiftsFromBookings,
  parseDurationMinutes,
  type SyncBooking,
  type SyncShift,
  type SyncBoat,
} from './generate-shifts'

const DIANA = 'boat-diana'
const CURACAO = 'boat-curacao'
const boats: SyncBoat[] = [
  { id: DIANA, name: 'Diana' },
  { id: CURACAO, name: 'Curaçao' },
]

function booking(overrides: Partial<SyncBooking>): SyncBooking {
  return {
    id: 'b1',
    booking_date: '2026-06-20',
    start_time: '2026-06-20T12:00:00.000Z',
    end_time: '2026-06-20T14:00:00.000Z',
    status: 'confirmed',
    category: 'private',
    customer_type_name: 'Diana - 2 Hours',
    fareharbor_availability_pk: null,
    ...overrides,
  }
}

function shift(overrides: Partial<SyncShift>): SyncShift {
  return {
    id: 's1',
    booking_id: 'b1',
    fareharbor_availability_pk: null,
    date: '2026-06-20',
    start_at: '2026-06-20T12:00:00.000Z',
    end_at: '2026-06-20T14:00:00.000Z',
    boat_id: DIANA,
    status: 'open',
    ...overrides,
  }
}

describe('parseDurationMinutes', () => {
  it('parses whole and fractional hours', () => {
    expect(parseDurationMinutes('Diana - 2 Hours')).toBe(120)
    expect(parseDurationMinutes('Diana - 1.5 Hours')).toBe(90)
    expect(parseDurationMinutes('Curaçao - 1,5 hours')).toBe(90)
    expect(parseDurationMinutes('3 hour private')).toBe(180)
  })

  it('returns null when no duration present', () => {
    expect(parseDurationMinutes('Adult (13+)')).toBeNull()
    expect(parseDurationMinutes(null)).toBeNull()
    expect(parseDurationMinutes('')).toBeNull()
  })
})

describe('private bookings', () => {
  it('creates one open shift per active private booking', () => {
    const result = generateShiftsFromBookings([booking({})], [], boats)
    expect(result.toCreate).toEqual([
      {
        date: '2026-06-20',
        start_at: '2026-06-20T12:00:00.000Z',
        end_at: '2026-06-20T14:00:00.000Z',
        boat_id: DIANA,
        booking_id: 'b1',
        fareharbor_availability_pk: null,
        status: 'open',
      },
    ])
    expect(result.toUpdate).toEqual([])
    expect(result.skipped).toEqual([])
  })

  it('resolves the boat from customer_type_name incl. diacritics', () => {
    const result = generateShiftsFromBookings(
      [booking({ customer_type_name: 'Curaçao - 2 Hours' })],
      [],
      boats,
    )
    expect(result.toCreate[0].boat_id).toBe(CURACAO)
  })

  it('resolves the boat case-insensitively and without diacritics', () => {
    const result = generateShiftsFromBookings(
      [booking({ customer_type_name: 'curacao - 1.5 Hours' })],
      [],
      boats,
    )
    expect(result.toCreate[0].boat_id).toBe(CURACAO)
  })

  it('skips private bookings whose boat cannot be resolved', () => {
    const result = generateShiftsFromBookings(
      [booking({ customer_type_name: 'Mystery Boat - 2 Hours' })],
      [],
      boats,
    )
    expect(result.toCreate).toEqual([])
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].reason).toContain('Mystery Boat')
  })

  it('skips bookings without a start time', () => {
    const result = generateShiftsFromBookings([booking({ start_time: null })], [], boats)
    expect(result.toCreate).toEqual([])
    expect(result.skipped[0].reason).toBe('no start time')
  })

  it('repairs end_time === start_time using the duration in customer_type_name', () => {
    const result = generateShiftsFromBookings(
      [booking({
        customer_type_name: 'Diana - 1.5 Hours',
        start_time: '2026-06-21T18:00:00.000Z',
        end_time: '2026-06-21T18:00:00.000Z',
        booking_date: '2026-06-21',
      })],
      [],
      boats,
    )
    expect(result.toCreate[0].end_at).toBe('2026-06-21T19:30:00.000Z')
  })

  it('repairs a missing end_time with the 2h private default when no duration is parseable', () => {
    const result = generateShiftsFromBookings(
      [booking({ customer_type_name: 'Diana - private charter', end_time: null })],
      [],
      boats,
    )
    // boat still resolves from prefix "Diana"; duration falls back to 120m
    expect(result.toCreate[0].end_at).toBe('2026-06-20T14:00:00.000Z')
  })

  it('does not create anything for cancelled / rebooked / pending_payment bookings', () => {
    const result = generateShiftsFromBookings(
      [
        booking({ id: 'c1', status: 'cancelled' }),
        booking({ id: 'c2', status: 'rebooked' }),
        booking({ id: 'c3', status: 'pending_payment' }),
      ],
      [],
      boats,
    )
    expect(result.toCreate).toEqual([])
    expect(result.toUpdate).toEqual([])
  })

  it('is idempotent: existing shift matching the booking produces no mutations', () => {
    const result = generateShiftsFromBookings([booking({})], [shift({})], boats)
    expect(result.toCreate).toEqual([])
    expect(result.toUpdate).toEqual([])
  })

  it('treats equivalent timestamps in different formats as equal', () => {
    const result = generateShiftsFromBookings(
      [booking({})],
      [shift({ start_at: '2026-06-20 12:00:00+00', end_at: '2026-06-20 14:00:00+00' })],
      boats,
    )
    expect(result.toUpdate).toEqual([])
  })

  it('updates the shift when the booking time changed', () => {
    const result = generateShiftsFromBookings(
      [booking({ start_time: '2026-06-20T15:00:00.000Z', end_time: '2026-06-20T17:00:00.000Z' })],
      [shift({})],
      boats,
    )
    expect(result.toUpdate).toEqual([
      {
        id: 's1',
        changes: { start_at: '2026-06-20T15:00:00.000Z', end_at: '2026-06-20T17:00:00.000Z' },
      },
    ])
  })

  it('updates the shift when the booking moved to another day', () => {
    const result = generateShiftsFromBookings(
      [booking({
        booking_date: '2026-06-22',
        start_time: '2026-06-22T12:00:00.000Z',
        end_time: '2026-06-22T14:00:00.000Z',
      })],
      [shift({})],
      boats,
    )
    expect(result.toUpdate[0].changes).toEqual({
      date: '2026-06-22',
      start_at: '2026-06-22T12:00:00.000Z',
      end_at: '2026-06-22T14:00:00.000Z',
    })
  })

  it('updates the boat when a private booking switched boats', () => {
    const result = generateShiftsFromBookings(
      [booking({ customer_type_name: 'Curaçao - 2 Hours' })],
      [shift({})],
      boats,
    )
    expect(result.toUpdate).toEqual([{ id: 's1', changes: { boat_id: CURACAO } }])
  })

  it('keeps staff assignment intact on updates (changes only touch time/boat/status)', () => {
    const result = generateShiftsFromBookings(
      [booking({ start_time: '2026-06-20T15:00:00.000Z', end_time: '2026-06-20T17:00:00.000Z' })],
      [shift({ status: 'confirmed' })],
      boats,
    )
    const keys = Object.keys(result.toUpdate[0].changes)
    expect(keys).not.toContain('staff_id')
    expect(keys).not.toContain('status')
  })

  it('cancels the shift when its booking was cancelled', () => {
    const result = generateShiftsFromBookings(
      [booking({ status: 'cancelled' })],
      [shift({ status: 'assigned' })],
      boats,
    )
    expect(result.toUpdate).toEqual([{ id: 's1', changes: { status: 'cancelled' } }])
  })

  it('cancels the shift when its booking disappeared via rebooking', () => {
    const result = generateShiftsFromBookings(
      [booking({ status: 'rebooked' })],
      [shift({ status: 'open' })],
      boats,
    )
    expect(result.toUpdate).toEqual([{ id: 's1', changes: { status: 'cancelled' } }])
  })

  it('does not re-cancel an already cancelled shift', () => {
    const result = generateShiftsFromBookings(
      [booking({ status: 'cancelled' })],
      [shift({ status: 'cancelled' })],
      boats,
    )
    expect(result.toUpdate).toEqual([])
  })

  it('reopens a cancelled shift when the booking is active again', () => {
    const result = generateShiftsFromBookings(
      [booking({})],
      [shift({ status: 'cancelled' })],
      boats,
    )
    expect(result.toUpdate).toEqual([{ id: 's1', changes: { status: 'open' } }])
  })

  it('never touches completed shifts', () => {
    const moved = booking({ start_time: '2026-06-20T15:00:00.000Z', end_time: '2026-06-20T17:00:00.000Z' })
    const result = generateShiftsFromBookings([moved], [shift({ status: 'completed' })], boats)
    expect(result.toUpdate).toEqual([])

    const gone = booking({ status: 'cancelled' })
    const result2 = generateShiftsFromBookings([gone], [shift({ status: 'completed' })], boats)
    expect(result2.toUpdate).toEqual([])
  })

  it('never touches manual shifts (no booking link)', () => {
    const manual = shift({ id: 'manual1', booking_id: null, fareharbor_availability_pk: null })
    const result = generateShiftsFromBookings([booking({})], [manual], boats)
    // booking b1 has no shift yet → creates one; manual shift untouched
    expect(result.toCreate).toHaveLength(1)
    expect(result.toUpdate).toEqual([])
  })
})

describe('shared bookings', () => {
  const sharedA = booking({
    id: 'sa',
    category: 'shared',
    customer_type_name: 'Adult (13+)',
    start_time: '2026-06-20T13:00:00.000Z',
    end_time: '2026-06-20T14:30:00.000Z',
    fareharbor_availability_pk: 555,
  })
  const sharedB = booking({
    id: 'sb',
    category: 'shared',
    customer_type_name: 'Adult (13+)',
    start_time: '2026-06-20T13:00:00.000Z',
    end_time: '2026-06-20T14:30:00.000Z',
    fareharbor_availability_pk: 555,
  })

  it('groups bookings on the same departure into ONE shift on Curaçao', () => {
    const result = generateShiftsFromBookings([sharedA, sharedB], [], boats)
    expect(result.toCreate).toEqual([
      {
        date: '2026-06-20',
        start_at: '2026-06-20T13:00:00.000Z',
        end_at: '2026-06-20T14:30:00.000Z',
        boat_id: CURACAO,
        booking_id: null,
        fareharbor_availability_pk: 555,
        status: 'open',
      },
    ])
  })

  it('creates separate shifts for different departures', () => {
    const other = { ...sharedB, id: 'sc', fareharbor_availability_pk: 556, start_time: '2026-06-20T16:00:00.000Z', end_time: '2026-06-20T17:30:00.000Z' }
    const result = generateShiftsFromBookings([sharedA, other], [], boats)
    expect(result.toCreate).toHaveLength(2)
  })

  it('repairs a missing end time with the 1.5h shared default', () => {
    const noEnd = { ...sharedA, end_time: null }
    const result = generateShiftsFromBookings([noEnd], [], boats)
    expect(result.toCreate[0].end_at).toBe('2026-06-20T14:30:00.000Z')
  })

  it('is idempotent against the existing departure shift', () => {
    const existing = shift({
      id: 'shared-shift',
      booking_id: null,
      fareharbor_availability_pk: 555,
      start_at: '2026-06-20T13:00:00.000Z',
      end_at: '2026-06-20T14:30:00.000Z',
      boat_id: CURACAO,
    })
    const result = generateShiftsFromBookings([sharedA, sharedB], [existing], boats)
    expect(result.toCreate).toEqual([])
    expect(result.toUpdate).toEqual([])
  })

  it('does NOT overwrite an admin boat change on a shared shift', () => {
    const movedToDiana = shift({
      id: 'shared-shift',
      booking_id: null,
      fareharbor_availability_pk: 555,
      start_at: '2026-06-20T13:00:00.000Z',
      end_at: '2026-06-20T14:30:00.000Z',
      boat_id: DIANA, // admin moved the sailing to Diana
    })
    const result = generateShiftsFromBookings([sharedA, sharedB], [movedToDiana], boats)
    expect(result.toUpdate).toEqual([])
  })

  it('keeps the shift while at least one booking in the group is active', () => {
    const cancelled = { ...sharedB, status: 'cancelled' }
    const existing = shift({
      id: 'shared-shift',
      booking_id: null,
      fareharbor_availability_pk: 555,
      start_at: '2026-06-20T13:00:00.000Z',
      end_at: '2026-06-20T14:30:00.000Z',
      boat_id: CURACAO,
      status: 'assigned',
    })
    const result = generateShiftsFromBookings([sharedA, cancelled], [existing], boats)
    expect(result.toUpdate).toEqual([])
  })

  it('cancels the departure shift when ALL its bookings are cancelled', () => {
    const c1 = { ...sharedA, status: 'cancelled' }
    const c2 = { ...sharedB, status: 'rebooked' }
    const existing = shift({
      id: 'shared-shift',
      booking_id: null,
      fareharbor_availability_pk: 555,
      boat_id: CURACAO,
      status: 'assigned',
    })
    const result = generateShiftsFromBookings([c1, c2], [existing], boats)
    expect(result.toUpdate).toEqual([{ id: 'shared-shift', changes: { status: 'cancelled' } }])
  })

  it('falls back to date+time grouping when availability pk is missing', () => {
    const noPkA = { ...sharedA, fareharbor_availability_pk: null }
    const noPkB = { ...sharedB, fareharbor_availability_pk: null }
    const result = generateShiftsFromBookings([noPkA, noPkB], [], boats)
    expect(result.toCreate).toHaveLength(1)
    // identity falls back to the first booking's id so the DB key still works
    expect(result.toCreate[0].booking_id).toBe('sa')
    expect(result.toCreate[0].fareharbor_availability_pk).toBeNull()
  })

  it('widens the window to span all bookings in the departure', () => {
    const longer = { ...sharedB, end_time: '2026-06-20T15:00:00.000Z' }
    const result = generateShiftsFromBookings([sharedA, longer], [], boats)
    expect(result.toCreate[0].start_at).toBe('2026-06-20T13:00:00.000Z')
    expect(result.toCreate[0].end_at).toBe('2026-06-20T15:00:00.000Z')
  })
})

describe('mixed runs', () => {
  it('sorts created shifts by start time', () => {
    const late = booking({ id: 'late', start_time: '2026-06-20T16:00:00.000Z', end_time: '2026-06-20T18:00:00.000Z' })
    const early = booking({ id: 'early', start_time: '2026-06-20T09:00:00.000Z', end_time: '2026-06-20T11:00:00.000Z' })
    const result = generateShiftsFromBookings([late, early], [], boats)
    expect(result.toCreate.map(s => s.booking_id)).toEqual(['early', 'late'])
  })

  it('handles an empty input without blowing up', () => {
    const result = generateShiftsFromBookings([], [], boats)
    expect(result).toEqual({ toCreate: [], toUpdate: [], skipped: [] })
  })
})
