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
  startTime: '2026-08-25T15:00:00Z',
  endTime: '2026-08-25T16:30:00Z',
  noRescheduleAsk: false,
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
    // Sophie (2 guests) is the smaller party, so she's asked to move onto
    // Paige's (4 guests) departure — she also happens to be the later date
    // here, but see the dedicated test below proving size decides this, not date.
    expect(c.booking.id).toBe('sophie')
    expect(c.receivingBooking.id).toBe('paige')
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

  it('skips a shift that already has a food order aboard — the supplier delivery is already committed', () => {
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

  it('does NOT skip a shift whose only extra is drinks — stocked on the boat, not delivered by a supplier (Beer, 2026-08-23)', () => {
    const shifts: ConsolidationShift[] = [
      shift({
        shiftId: 'tue-shift',
        date: '2026-08-25',
        bookings: [
          {
            ...baseBooking,
            id: 'paige',
            guestCount: 4,
            fareharborAvailabilityPk: 1001,
            extrasSelected: [{ name: 'Unlimited Drinks', category: 'drinks', amount_cents: 3000, quantity: 1 }],
          },
        ],
      }),
      shift({
        shiftId: 'wed-shift',
        date: '2026-08-26',
        bookings: [{ ...baseBooking, id: 'sophie', guestCount: 2, fareharborAvailabilityPk: 1002 }],
      }),
    ]

    const candidates = findCrossDayConsolidationCandidates(shifts, { Curaçao: 12 })
    expect(candidates).toHaveLength(1)
    expect(candidates[0].booking.id).toBe('sophie')
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

  it('skips a booking flagged no_reschedule_ask, even though it would otherwise be a clean match (Beer, 2026-08-23: anniversary/birthday bookings)', () => {
    const shifts: ConsolidationShift[] = [
      shift({
        shiftId: 's1',
        date: '2026-08-25',
        bookings: [{ ...baseBooking, id: 'a', guestCount: 2, fareharborAvailabilityPk: 1, noRescheduleAsk: true }],
      }),
      shift({
        shiftId: 's2',
        date: '2026-08-26',
        bookings: [{ ...baseBooking, id: 'b', guestCount: 2, fareharborAvailabilityPk: 2 }],
      }),
    ]

    expect(findCrossDayConsolidationCandidates(shifts, { Curaçao: 12 })).toEqual([])
  })

  it('skips a departure with more than one booking aboard it — moving it means asking several parties at once', () => {
    const shifts: ConsolidationShift[] = [
      shift({
        shiftId: 's1',
        date: '2026-08-25',
        bookings: [
          // Two bookings sharing ONE departure (same pk) — not a second,
          // independent sailing. eligibleToMove requires exactly one booking
          // per departure group, so this group is excluded, but the shift's
          // OTHER departure (pk 3, single booking) is still independently
          // eligible — see the next test.
          { ...baseBooking, id: 'a1', guestCount: 2, fareharborAvailabilityPk: 1 },
          { ...baseBooking, id: 'a1b', guestCount: 1, fareharborAvailabilityPk: 1 },
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

  it('treats each distinct departure on a multi-departure shift independently — a real Curaçao shape (Beer, 2026-08-23)', () => {
    // Wednesday's Curaçao shift covers TWO separate sailings: an unrelated
    // private cruise (never eligible to move) and Sophie's shared departure
    // (eligible). Moving Sophie doesn't free the whole shift — the private
    // departure still needs the boat — but it DOES shrink the shift's
    // prep-to-wrap-up span, which is a real, smaller saving. This is the
    // multi-departure case shift_bookings resolution exists to catch.
    const shifts: ConsolidationShift[] = [
      shift({
        shiftId: 'tue-shift',
        date: '2026-08-25',
        bookings: [{ ...baseBooking, id: 'paige', guestCount: 4, fareharborAvailabilityPk: 1001 }],
      }),
      shift({
        shiftId: 'wed-shift',
        date: '2026-08-26',
        startAt: '2026-08-26T12:15:00Z',
        endAt: '2026-08-26T17:30:00Z',
        bookings: [
          {
            ...baseBooking,
            id: 'private-booking',
            category: 'private',
            guestCount: 6,
            fareharborAvailabilityPk: null,
            startTime: '2026-08-26T13:00:00Z',
            endTime: '2026-08-26T14:30:00Z',
          },
          { ...baseBooking, id: 'sophie', guestCount: 2, fareharborAvailabilityPk: 1002 },
        ],
      }),
    ]

    const candidates = findCrossDayConsolidationCandidates(shifts, { Curaçao: 12 })

    expect(candidates).toHaveLength(1)
    const c = candidates[0]
    expect(c.booking.id).toBe('sophie')
    expect(c.receivingBooking.id).toBe('paige')
    // Shrink, not elimination: the private departure (13:00-14:30) stays
    // behind, so Wednesday's shift narrows around it instead of vanishing.
    expect(c.estSavingCents).toBeGreaterThan(0)
    expect(c.estSavingCents).toBeLessThan(18375)
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

  describe('which party gets asked to move (Beer, 2026-08-23: smaller party, not just "later date")', () => {
    it('asks the EARLIER day to move when it is the smaller party — proves size decides, not date', () => {
      const shifts: ConsolidationShift[] = [
        shift({
          shiftId: 'tue-shift',
          date: '2026-08-25',
          bookings: [{ ...baseBooking, id: 'small-party', guestCount: 2, fareharborAvailabilityPk: 1 }],
        }),
        shift({
          shiftId: 'wed-shift',
          date: '2026-08-26',
          bookings: [{ ...baseBooking, id: 'big-party', guestCount: 4, fareharborAvailabilityPk: 2 }],
        }),
      ]

      const candidates = findCrossDayConsolidationCandidates(shifts, { Curaçao: 12 })

      expect(candidates).toHaveLength(1)
      const c = candidates[0]
      expect(c.booking.id).toBe('small-party')
      expect(c.receivingBooking.id).toBe('big-party')
      expect(c.fromDate).toBe('2026-08-25') // the earlier day, moving forward onto Wed
      expect(c.toDate).toBe('2026-08-26')
    })

    it('defaults to the later day moving when both parties are the same size (a tie)', () => {
      const shifts: ConsolidationShift[] = [
        shift({
          shiftId: 'tue-shift',
          date: '2026-08-25',
          bookings: [{ ...baseBooking, id: 'tue-party', guestCount: 2, fareharborAvailabilityPk: 1 }],
        }),
        shift({
          shiftId: 'wed-shift',
          date: '2026-08-26',
          bookings: [{ ...baseBooking, id: 'wed-party', guestCount: 2, fareharborAvailabilityPk: 2 }],
        }),
      ]

      const candidates = findCrossDayConsolidationCandidates(shifts, { Curaçao: 12 })

      expect(candidates).toHaveLength(1)
      expect(candidates[0].booking.id).toBe('wed-party')
      expect(candidates[0].fromDate).toBe('2026-08-26')
    })
  })

  describe('every booking appears in at most one candidate (Beer, 2026-08-23: "highest-saving wins" — a real bug, confirmed by tracing the code)', () => {
    it('a booking exactly 1 day from BOTH neighbors is never offered twice, even though both pairings are individually valid', () => {
      // Tuesday's small party sits exactly 1 day from both Monday and
      // Wednesday — geometrically two separate valid pairings, both with
      // Tuesday as the (smaller, so moving) party. Before the fix, this
      // produced two candidates for the SAME booking; the second one's
      // idempotency lookup (keyed only on booking_id) would silently reuse
      // the first one's drafted message, showing the WRONG destination.
      const shifts: ConsolidationShift[] = [
        shift({
          shiftId: 'mon-shift',
          date: '2026-08-24',
          bookings: [{ ...baseBooking, id: 'monday-party', guestCount: 4, fareharborAvailabilityPk: 1 }],
        }),
        shift({
          shiftId: 'tue-shift',
          date: '2026-08-25',
          bookings: [{ ...baseBooking, id: 'tuesday-party', guestCount: 2, fareharborAvailabilityPk: 2 }],
        }),
        shift({
          shiftId: 'wed-shift',
          date: '2026-08-26',
          bookings: [{ ...baseBooking, id: 'wednesday-party', guestCount: 4, fareharborAvailabilityPk: 3 }],
        }),
      ]

      const candidates = findCrossDayConsolidationCandidates(shifts, { Curaçao: 12 })

      const bookingIdAppearances = candidates.flatMap(c => [c.booking.id, c.receivingBooking.id])
      const counts = new Map<string, number>()
      for (const id of bookingIdAppearances) counts.set(id, (counts.get(id) ?? 0) + 1)
      expect(Math.max(...counts.values())).toBe(1)
      // Tuesday's own vacate-cost is identical whichever neighbor receives it
      // (same shift being removed either way) — a genuine tie, so only the
      // COUNT invariant is asserted here, not which specific neighbor wins.
      expect(candidates).toHaveLength(1)
    })

    it('two DIFFERENT movers wanting the SAME receiving day keep only the higher-saving one', () => {
      // Monday and Wednesday are each exactly 1 day from Tuesday but 2 days
      // from each other, so they never pair with one another — the only
      // conflict is both wanting Tuesday's spare capacity. Wednesday's
      // shift costs more per hour, so moving it away saves more.
      const shifts: ConsolidationShift[] = [
        shift({
          shiftId: 'mon-shift',
          date: '2026-08-24',
          startAt: '2026-08-24T14:15:00Z',
          endAt: '2026-08-24T17:30:00Z',
          hourlyRateCents: 3000,
          bookings: [{ ...baseBooking, id: 'monday-mover', guestCount: 2, fareharborAvailabilityPk: 1, startTime: '2026-08-24T15:00:00Z', endTime: '2026-08-24T16:30:00Z' }],
        }),
        shift({
          shiftId: 'tue-shift',
          date: '2026-08-25',
          bookings: [{ ...baseBooking, id: 'tuesday-receiver', guestCount: 2, fareharborAvailabilityPk: 2 }],
        }),
        shift({
          shiftId: 'wed-shift',
          date: '2026-08-26',
          startAt: '2026-08-26T14:15:00Z',
          endAt: '2026-08-26T17:30:00Z',
          hourlyRateCents: 5000,
          bookings: [{ ...baseBooking, id: 'wednesday-mover', guestCount: 2, fareharborAvailabilityPk: 3, startTime: '2026-08-26T15:00:00Z', endTime: '2026-08-26T16:30:00Z' }],
        }),
      ]

      const candidates = findCrossDayConsolidationCandidates(shifts, { Curaçao: 12 })

      expect(candidates).toHaveLength(1)
      expect(candidates[0].booking.id).toBe('wednesday-mover') // higher hourly rate → bigger saving
      expect(candidates[0].receivingBooking.id).toBe('tuesday-receiver')
    })
  })

  describe('food only excludes the MOVING side, never the stationary receiver (Beer, 2026-08-23)', () => {
    it('a receiving party with a food order is still a valid target — their own booking never changes', () => {
      const shifts: ConsolidationShift[] = [
        // Deliberately the SMALLER party so it's unambiguously the mover
        // (Beer's "smaller party moves" rule) regardless of date order.
        shift({
          shiftId: 's1',
          date: '2026-08-25',
          bookings: [{ ...baseBooking, id: 'mover', guestCount: 2, fareharborAvailabilityPk: 1 }],
        }),
        shift({
          shiftId: 's2',
          date: '2026-08-26',
          bookings: [
            {
              ...baseBooking,
              id: 'receiver-with-food',
              guestCount: 4,
              fareharborAvailabilityPk: 2,
              extrasSelected: [{ name: 'Cheese board', category: 'food', amount_cents: 1000, quantity: 1 }],
            },
          ],
        }),
      ]

      const candidates = findCrossDayConsolidationCandidates(shifts, { Curaçao: 12 })

      expect(candidates).toHaveLength(1)
      expect(candidates[0].booking.id).toBe('mover')
      expect(candidates[0].receivingBooking.id).toBe('receiver-with-food')
    })

    it('a receiving party flagged no_reschedule_ask is still excluded — their OWN experience changes when a stranger joins', () => {
      const shifts: ConsolidationShift[] = [
        shift({
          shiftId: 's1',
          date: '2026-08-25',
          bookings: [{ ...baseBooking, id: 'mover', guestCount: 2, fareharborAvailabilityPk: 1 }],
        }),
        shift({
          shiftId: 's2',
          date: '2026-08-26',
          bookings: [{ ...baseBooking, id: 'protected-receiver', guestCount: 2, fareharborAvailabilityPk: 2, noRescheduleAsk: true }],
        }),
      ]

      expect(findCrossDayConsolidationCandidates(shifts, { Curaçao: 12 })).toEqual([])
    })
  })
})
