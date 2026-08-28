import { describe, it, expect } from 'vitest'
import {
  generateShiftsFromBookings,
  parseDurationMinutes,
  PREP_MINUTES_BEFORE_FIRST,
  WRAP_MINUTES_AFTER_LAST,
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
    date: '2026-06-20',
    start_at: '2026-06-20T11:15:00.000Z',
    end_at: '2026-06-20T15:00:00.000Z',
    boat_id: DIANA,
    status: 'open',
    booking_ids: ['b1'],
    ...overrides,
  }
}

/** Minutes between two ISO instants — reads better than raw ms in assertions. */
function minutesBetween(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000
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

describe('padding — a shift is the cruise plus the work around it', () => {
  it('starts 45 minutes before the cruise and ends 60 minutes after it', () => {
    const { toCreate } = generateShiftsFromBookings([booking({})], [], boats)

    expect(toCreate).toHaveLength(1)
    // Cruise is 12:00–14:00 → shift is 11:15–15:00.
    expect(toCreate[0].start_at).toBe('2026-06-20T11:15:00.000Z')
    expect(toCreate[0].end_at).toBe('2026-06-20T15:00:00.000Z')
    expect(minutesBetween(toCreate[0].start_at, '2026-06-20T12:00:00.000Z')).toBe(PREP_MINUTES_BEFORE_FIRST)
    expect(minutesBetween('2026-06-20T14:00:00.000Z', toCreate[0].end_at)).toBe(WRAP_MINUTES_AFTER_LAST)
  })

  it('keeps the operating date even when prep crosses back over midnight', () => {
    // 00:30 departure → prep starts 23:45 the PREVIOUS day, but the shift still
    // belongs to the day the boat actually sails.
    const { toCreate } = generateShiftsFromBookings(
      [booking({ start_time: '2026-06-20T00:30:00.000Z', end_time: '2026-06-20T02:00:00.000Z' })],
      [],
      boats,
    )

    expect(toCreate[0].start_at).toBe('2026-06-19T23:45:00.000Z')
    expect(toCreate[0].date).toBe('2026-06-20')
  })
})

describe('merging — back-to-back cruises on one boat are one shift', () => {
  it('merges two cruises 30 minutes apart into a single block', () => {
    // The real turnaround pattern: 10:00–12:00 then 12:30–14:30 on Diana.
    const a = booking({ id: 'a', start_time: '2026-06-20T10:00:00.000Z', end_time: '2026-06-20T12:00:00.000Z' })
    const b = booking({ id: 'b', start_time: '2026-06-20T12:30:00.000Z', end_time: '2026-06-20T14:30:00.000Z' })

    const { toCreate } = generateShiftsFromBookings([a, b], [], boats)

    expect(toCreate).toHaveLength(1)
    expect(toCreate[0].start_at).toBe('2026-06-20T09:15:00.000Z') // 10:00 − 45m
    expect(toCreate[0].end_at).toBe('2026-06-20T15:30:00.000Z') // 14:30 + 60m
    expect(toCreate[0].booking_ids.sort()).toEqual(['a', 'b'])
  })

  it('merges three back-to-back cruises into ONE continuous shift, not three', () => {
    const bookings = [
      booking({ id: 'a', start_time: '2026-06-20T10:00:00.000Z', end_time: '2026-06-20T12:00:00.000Z' }),
      booking({ id: 'b', start_time: '2026-06-20T12:30:00.000Z', end_time: '2026-06-20T14:30:00.000Z' }),
      booking({ id: 'c', start_time: '2026-06-20T15:00:00.000Z', end_time: '2026-06-20T17:00:00.000Z' }),
    ]

    const { toCreate } = generateShiftsFromBookings(bookings, [], boats)

    expect(toCreate).toHaveLength(1)
    expect(toCreate[0].start_at).toBe('2026-06-20T09:15:00.000Z')
    expect(toCreate[0].end_at).toBe('2026-06-20T18:00:00.000Z')
    expect(toCreate[0].booking_ids.sort()).toEqual(['a', 'b', 'c'])
  })

  it('keeps a morning and an evening cruise in ONE shift — a boat has one captain for the day', () => {
    // Beer's rule: 1 boat = 1 shift. Even a 4.5-hour midday gap does not split
    // the day into two separately-fillable shifts.
    const morning = booking({ id: 'am', start_time: '2026-06-20T09:00:00.000Z', end_time: '2026-06-20T11:00:00.000Z' })
    const evening = booking({ id: 'pm', start_time: '2026-06-20T15:30:00.000Z', end_time: '2026-06-20T17:30:00.000Z' })

    const { toCreate } = generateShiftsFromBookings([morning, evening], [], boats)

    expect(toCreate).toHaveLength(1)
    expect(toCreate[0].booking_ids.sort()).toEqual(['am', 'pm'])
    expect(toCreate[0].start_at).toBe('2026-06-20T08:15:00.000Z') // 09:00 − 45m
    expect(toCreate[0].end_at).toBe('2026-06-20T18:30:00.000Z') // 17:30 + 60m
  })

  it('covers the whole day however large the gap between departures', () => {
    // The 9-hour gap that exists in the live data — still one shift.
    const early = booking({ id: 'early', start_time: '2026-06-20T08:00:00.000Z', end_time: '2026-06-20T10:00:00.000Z' })
    const late = booking({ id: 'late', start_time: '2026-06-20T19:00:00.000Z', end_time: '2026-06-20T21:00:00.000Z' })

    const { toCreate } = generateShiftsFromBookings([early, late], [], boats)

    expect(toCreate).toHaveLength(1)
    expect(toCreate[0].booking_ids.sort()).toEqual(['early', 'late'])
  })

  it('never merges across different boats, however close in time', () => {
    const diana = booking({ id: 'd', customer_type_name: 'Diana - 2 Hours' })
    const curacao = booking({ id: 'c', customer_type_name: 'Curaçao - 2 Hours' })

    const { toCreate } = generateShiftsFromBookings([diana, curacao], [], boats)

    expect(toCreate).toHaveLength(2)
    expect(toCreate.map(s => s.boat_id).sort()).toEqual([CURACAO, DIANA].sort())
  })

  it('never merges across different days', () => {
    const day1 = booking({ id: 'd1', booking_date: '2026-06-20', start_time: '2026-06-20T20:00:00.000Z', end_time: '2026-06-20T22:00:00.000Z' })
    const day2 = booking({ id: 'd2', booking_date: '2026-06-21', start_time: '2026-06-21T09:00:00.000Z', end_time: '2026-06-21T11:00:00.000Z' })

    const { toCreate } = generateShiftsFromBookings([day1, day2], [], boats)

    expect(toCreate).toHaveLength(2)
  })
})

describe('shared departures', () => {
  it('collapses everyone on one shared sailing into a single shift', () => {
    const shared = (id: string) =>
      booking({
        id,
        category: 'shared',
        customer_type_name: 'Adult (13+)',
        fareharbor_availability_pk: 5001,
        start_time: '2026-06-20T15:00:00.000Z',
        end_time: '2026-06-20T16:30:00.000Z',
      })

    const { toCreate } = generateShiftsFromBookings([shared('x'), shared('y'), shared('z')], [], boats)

    expect(toCreate).toHaveLength(1)
    expect(toCreate[0].boat_id).toBe(CURACAO)
    expect(toCreate[0].booking_ids.sort()).toEqual(['x', 'y', 'z'])
    expect(toCreate[0].fareharbor_availability_pk).toBe(5001)
    expect(toCreate[0].start_at).toBe('2026-06-20T14:15:00.000Z')
    expect(toCreate[0].end_at).toBe('2026-06-20T17:30:00.000Z')
  })

  it('merges a shared and a private departure that sit back-to-back on the same boat', () => {
    const shared = booking({
      id: 's',
      category: 'shared',
      customer_type_name: 'Adult (13+)',
      fareharbor_availability_pk: 900,
      start_time: '2026-06-20T10:00:00.000Z',
      end_time: '2026-06-20T11:30:00.000Z',
    })
    const priv = booking({
      id: 'p',
      customer_type_name: 'Curaçao - 2 Hours',
      start_time: '2026-06-20T12:00:00.000Z',
      end_time: '2026-06-20T14:00:00.000Z',
    })

    const { toCreate } = generateShiftsFromBookings([shared, priv], [], boats)

    expect(toCreate).toHaveLength(1)
    expect(toCreate[0].booking_ids.sort()).toEqual(['p', 's'])
  })
})

describe('re-sync — an existing shift keeps its captain', () => {
  it('matches by shared membership and updates times in place', () => {
    const existing = shift({ id: 'keep', booking_ids: ['b1'], start_at: '2026-06-20T11:15:00.000Z', end_at: '2026-06-20T15:00:00.000Z' })
    // The cruise moved an hour later.
    const moved = booking({ start_time: '2026-06-20T13:00:00.000Z', end_time: '2026-06-20T15:00:00.000Z' })

    const { toCreate, toUpdate } = generateShiftsFromBookings([moved], [existing], boats)

    expect(toCreate).toHaveLength(0)
    expect(toUpdate).toHaveLength(1)
    expect(toUpdate[0].id).toBe('keep')
    expect(toUpdate[0].changes.start_at).toBe('2026-06-20T12:15:00.000Z')
    expect(toUpdate[0].changes.end_at).toBe('2026-06-20T16:00:00.000Z')
  })

  it('absorbs a newly-added cruise into the existing shift instead of creating a second one', () => {
    // This is the case that used to produce a stray extra shift: the captain is
    // already assigned to the morning block, then a second cruise lands right
    // after it.
    const existing = shift({ id: 'assigned', status: 'assigned', booking_ids: ['a'] })
    const a = booking({ id: 'a', start_time: '2026-06-20T10:00:00.000Z', end_time: '2026-06-20T12:00:00.000Z' })
    const b = booking({ id: 'b', start_time: '2026-06-20T12:30:00.000Z', end_time: '2026-06-20T14:30:00.000Z' })

    const { toCreate, toUpdate } = generateShiftsFromBookings([a, b], [existing], boats)

    expect(toCreate).toHaveLength(0)
    expect(toUpdate).toHaveLength(1)
    expect(toUpdate[0].id).toBe('assigned')
    expect(toUpdate[0].booking_ids.sort()).toEqual(['a', 'b'])
    expect(toUpdate[0].changes.end_at).toBe('2026-06-20T15:30:00.000Z')
  })

  it('cancels a shift once every cruise it covered is gone', () => {
    const existing = shift({ id: 'dead', booking_ids: ['b1'] })
    const cancelled = booking({ status: 'cancelled' })

    const { toUpdate } = generateShiftsFromBookings([cancelled], [existing], boats)

    expect(toUpdate).toEqual([{ id: 'dead', changes: { status: 'cancelled' }, booking_ids: [] }])
  })

  it('revives a cancelled shift when its cruise comes back', () => {
    const existing = shift({ id: 'back', status: 'cancelled', booking_ids: ['b1'] })

    const { toUpdate } = generateShiftsFromBookings([booking({})], [existing], boats)

    expect(toUpdate[0].changes.status).toBe('open')
  })

  it('never rewrites the times of a completed shift', () => {
    const existing = shift({ id: 'done', status: 'completed', booking_ids: ['b1'], start_at: '2026-06-20T08:00:00.000Z' })

    const { toUpdate } = generateShiftsFromBookings([booking({})], [existing], boats)

    expect(toUpdate).toHaveLength(1)
    expect(toUpdate[0].changes).toEqual({})
  })

  it('leaves manual shifts (covering no bookings) completely alone', () => {
    const manual = shift({ id: 'manual', booking_ids: [] })

    const { toCreate, toUpdate } = generateShiftsFromBookings([], [manual], boats)

    expect(toUpdate).toHaveLength(0)
    expect(toCreate).toHaveLength(0)
  })

  it('does not let one boat\'s block claim another boat\'s existing shift', () => {
    // Only the block that actually shares a booking may claim it; the other
    // boat must get its own new shift rather than stealing this one.
    const existing = shift({ id: 'diana-shift', boat_id: DIANA, booking_ids: ['d'] })
    const diana = booking({ id: 'd', customer_type_name: 'Diana - 2 Hours' })
    const curacao = booking({ id: 'c', customer_type_name: 'Curaçao - 2 Hours' })

    const { toCreate, toUpdate } = generateShiftsFromBookings([diana, curacao], [existing], boats)

    expect(toUpdate).toHaveLength(1)
    expect(toUpdate[0].id).toBe('diana-shift')
    expect(toCreate).toHaveLength(1)
    expect(toCreate[0].booking_ids).toEqual(['c'])
    expect(toCreate[0].boat_id).toBe(CURACAO)
  })
})

describe('boat resolution', () => {
  it('keeps the admin-chosen boat on a shared shift', () => {
    // Shared defaults to Curaçao, but the admin moved this sailing to Diana.
    const existing = shift({ id: 's', boat_id: DIANA, booking_ids: ['x'] })
    const shared = booking({
      id: 'x',
      category: 'shared',
      customer_type_name: 'Adult (13+)',
      fareharbor_availability_pk: 77,
    })

    const { toUpdate } = generateShiftsFromBookings([shared], [existing], boats)

    expect(toUpdate[0].changes.boat_id).toBeUndefined()
  })

  it('corrects the boat on a private shift, which names its own boat', () => {
    const existing = shift({ id: 's', boat_id: CURACAO, booking_ids: ['b1'] })

    const { toUpdate } = generateShiftsFromBookings([booking({ customer_type_name: 'Diana - 2 Hours' })], [existing], boats)

    expect(toUpdate[0].changes.boat_id).toBe(DIANA)
  })

  it('skips a booking whose boat cannot be resolved', () => {
    const { toCreate, skipped } = generateShiftsFromBookings(
      [booking({ customer_type_name: 'Mystery Boat - 2 Hours' })],
      [],
      boats,
    )

    expect(toCreate).toHaveLength(0)
    expect(skipped).toEqual([{ bookingId: 'b1', reason: 'cannot resolve boat from "Mystery Boat - 2 Hours"' }])
  })

  it('skips a booking with no start time', () => {
    const { toCreate, skipped } = generateShiftsFromBookings([booking({ start_time: null })], [], boats)

    expect(toCreate).toHaveLength(0)
    expect(skipped).toEqual([{ bookingId: 'b1', reason: 'no start time' }])
  })
})

describe('window repair', () => {
  it('derives a missing end time from the duration in the customer type', () => {
    const { toCreate } = generateShiftsFromBookings(
      [booking({ end_time: null, customer_type_name: 'Diana - 1.5 Hours' })],
      [],
      boats,
    )

    // 12:00 + 90m cruise = 13:30, + 60m wrap = 14:30.
    expect(toCreate[0].end_at).toBe('2026-06-20T14:30:00.000Z')
  })

  it('falls back to 90 minutes for a shared cruise with no usable end', () => {
    const { toCreate } = generateShiftsFromBookings(
      [booking({ category: 'shared', customer_type_name: 'Adult (13+)', fareharbor_availability_pk: 1, end_time: null })],
      [],
      boats,
    )

    expect(toCreate[0].end_at).toBe('2026-06-20T14:30:00.000Z')
  })
})
