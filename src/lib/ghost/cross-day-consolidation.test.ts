import { describe, it, expect } from 'vitest'
import { findCrossDayConsolidationCandidates, type ConsolidationShift } from './cross-day-consolidation'

const baseBooking = {
  category: 'shared',
  customerTypeName: 'Adult (13+)',
  customerName: 'Guest',
  customerEmail: 'guest@example.com',
  customerPhone: null,
  totalCents: 6000,
  listingTitle: 'Shared Sunset Cruise',
  extrasSelected: null,
}

function shift(overrides: Partial<ConsolidationShift> & { shiftId: string }): ConsolidationShift {
  return {
    boat: 'Curaçao',
    date: '2026-08-25',
    startAt: '2026-08-25T14:15:00Z',
    endAt: '2026-08-25T17:30:00Z',
    hourlyRateCents: 3500,
    bookings: [],
    ...overrides,
  }
}

describe('findCrossDayConsolidationCandidates', () => {
  it('finds a Tuesday/Wednesday pair — real Paige/Sophie shape', () => {
    const shifts: ConsolidationShift[] = [
      shift({
        shiftId: 'tue-shift',
        date: '2026-08-25',
        startAt: '2026-08-25T14:15:00Z',
        endAt: '2026-08-25T17:30:00Z',
        bookings: [{ ...baseBooking, id: 'paige', guestCount: 4, fareharborAvailabilityPk: 1001 }],
      }),
      shift({
        shiftId: 'wed-shift',
        date: '2026-08-26',
        startAt: '2026-08-26T12:15:00Z',
        endAt: '2026-08-26T17:30:00Z',
        bookings: [{ ...baseBooking, id: 'sophie', guestCount: 2, fareharborAvailabilityPk: 1002 }],
      }),
    ]

    const candidates = findCrossDayConsolidationCandidates(shifts, { Curaçao: 12, Diana: 8 })

    expect(candidates).toHaveLength(1)
    const c = candidates[0]
    // The LATER day's booking moves onto the earlier day's departure — same
    // bias as selectMoveCandidate's "pull the later sailing earlier" default.
    expect(c.booking.id).toBe('sophie')
    expect(c.fromDate).toBe('2026-08-26')
    expect(c.toDate).toBe('2026-08-25')
    expect(c.combinedGuestCount).toBe(6)
    expect(c.capacity).toBe(12)
    // Wednesday's full shift (5h15m) at €35/hr = 183.75 -> 18375 cents.
    expect(c.estSavingCents).toBe(18375)
  })

  it('does not propose a move when combined guests exceed the receiving boat capacity', () => {
    const shifts: ConsolidationShift[] = [
      shift({
        shiftId: 's1',
        date: '2026-08-25',
        bookings: [{ ...baseBooking, id: 'a', guestCount: 8, fareharborAvailabilityPk: 1 }],
      }),
      shift({
        shiftId: 's2',
        date: '2026-08-26',
        bookings: [{ ...baseBooking, id: 'b', guestCount: 8, fareharborAvailabilityPk: 2 }],
      }),
    ]

    expect(findCrossDayConsolidationCandidates(shifts, { Curaçao: 12 })).toEqual([])
  })

  it('skips a pair on different products (customer type name differs) — the ask promises "same cruise"', () => {
    const shifts: ConsolidationShift[] = [
      shift({
        shiftId: 's1',
        date: '2026-08-25',
        bookings: [{ ...baseBooking, id: 'a', guestCount: 2, fareharborAvailabilityPk: 1 }],
      }),
      shift({
        shiftId: 's2',
        date: '2026-08-26',
        bookings: [{ ...baseBooking, id: 'b', guestCount: 2, fareharborAvailabilityPk: 2, customerTypeName: 'Adult + Unlimited Drinks' }],
      }),
    ]

    expect(findCrossDayConsolidationCandidates(shifts, { Curaçao: 12 })).toEqual([])
  })

  it('skips a shift that already has catering aboard — the supplier order is already placed', () => {
    const shifts: ConsolidationShift[] = [
      shift({
        shiftId: 's1',
        date: '2026-08-25',
        bookings: [{ ...baseBooking, id: 'a', guestCount: 2, fareharborAvailabilityPk: 1 }],
      }),
      shift({
        shiftId: 's2',
        date: '2026-08-26',
        bookings: [
          {
            ...baseBooking,
            id: 'b',
            guestCount: 2,
            fareharborAvailabilityPk: 2,
            extrasSelected: [{ name: 'Cheese board', category: 'food', amount_cents: 1000, quantity: 1 }],
          },
        ],
      }),
    ]

    expect(findCrossDayConsolidationCandidates(shifts, { Curaçao: 12 })).toEqual([])
  })

  it('skips private shifts entirely — private cruises never merge onto another party\'s boat', () => {
    const shifts: ConsolidationShift[] = [
      shift({
        shiftId: 's1',
        date: '2026-08-25',
        bookings: [{ ...baseBooking, id: 'a', category: 'private', guestCount: 2, fareharborAvailabilityPk: 1 }],
      }),
      shift({
        shiftId: 's2',
        date: '2026-08-26',
        bookings: [{ ...baseBooking, id: 'b', category: 'private', guestCount: 2, fareharborAvailabilityPk: 2 }],
      }),
    ]

    expect(findCrossDayConsolidationCandidates(shifts, { Curaçao: 12 })).toEqual([])
  })

  it('skips a shift covering more than one departure — moving it means asking several parties at once', () => {
    const shifts: ConsolidationShift[] = [
      shift({
        shiftId: 's1',
        date: '2026-08-25',
        bookings: [
          { ...baseBooking, id: 'a1', guestCount: 2, fareharborAvailabilityPk: 1 },
          { ...baseBooking, id: 'a2', guestCount: 2, fareharborAvailabilityPk: 3 },
        ],
      }),
      shift({
        shiftId: 's2',
        date: '2026-08-26',
        bookings: [{ ...baseBooking, id: 'b', guestCount: 2, fareharborAvailabilityPk: 2 }],
      }),
    ]

    expect(findCrossDayConsolidationCandidates(shifts, { Curaçao: 12 })).toEqual([])
  })

  it('does not propose a move for days more than 1 day apart', () => {
    const shifts: ConsolidationShift[] = [
      shift({
        shiftId: 's1',
        date: '2026-08-25',
        bookings: [{ ...baseBooking, id: 'a', guestCount: 2, fareharborAvailabilityPk: 1 }],
      }),
      shift({
        shiftId: 's2',
        date: '2026-08-27',
        bookings: [{ ...baseBooking, id: 'b', guestCount: 2, fareharborAvailabilityPk: 2 }],
      }),
    ]

    expect(findCrossDayConsolidationCandidates(shifts, { Curaçao: 12 })).toEqual([])
  })

  it('returns 0 estSavingCents (not null, not a crash) when the eliminated shift has no captain rate yet', () => {
    const shifts: ConsolidationShift[] = [
      shift({
        shiftId: 'tue-shift',
        date: '2026-08-25',
        hourlyRateCents: null,
        bookings: [{ ...baseBooking, id: 'paige', guestCount: 4, fareharborAvailabilityPk: 1001 }],
      }),
      shift({
        shiftId: 'wed-shift',
        date: '2026-08-26',
        hourlyRateCents: null,
        bookings: [{ ...baseBooking, id: 'sophie', guestCount: 2, fareharborAvailabilityPk: 1002 }],
      }),
    ]

    const candidates = findCrossDayConsolidationCandidates(shifts, { Curaçao: 12 })
    expect(candidates).toHaveLength(1)
    expect(candidates[0].estSavingCents).toBe(0)
  })

  it('ignores different boats — a Diana departure and a Curaçao departure never merge onto each other here', () => {
    const shifts: ConsolidationShift[] = [
      shift({
        shiftId: 's1',
        date: '2026-08-25',
        boat: 'Diana',
        bookings: [{ ...baseBooking, id: 'a', guestCount: 2, fareharborAvailabilityPk: 1 }],
      }),
      shift({
        shiftId: 's2',
        date: '2026-08-26',
        boat: 'Curaçao',
        bookings: [{ ...baseBooking, id: 'b', guestCount: 2, fareharborAvailabilityPk: 2 }],
      }),
    ]

    expect(findCrossDayConsolidationCandidates(shifts, { Curaçao: 12, Diana: 8 })).toEqual([])
  })
})
