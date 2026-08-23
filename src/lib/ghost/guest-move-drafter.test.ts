import { describe, it, expect } from 'vitest'
import { selectMoveCandidate, pickSnapSlot, MIN_GAP_MINUTES, type MoveBooking } from './guest-move-drafter'
import type { OpsReviewShift } from './ops-review'

/**
 * The guest-outreach hard rules live in selectMoveCandidate, in code — these
 * tests pin them so a refactor can never quietly start texting the wrong
 * guests: catering bookings (Beer 2026-07-04), multi-party departures, and
 * contactless bookings are untouchable. Private cruises are NOT untouchable —
 * they can be time/boat moved at the same threshold as shared (Beer
 * 2026-07-04), just never merged onto another party's departure.
 */

type ShiftWithBooking = OpsReviewShift & { bookingId: string | null; availabilityPk: number | null }

function shift(overrides: Partial<ShiftWithBooking> & { id: string }): ShiftWithBooking {
  return {
    boat: 'Diana',
    boatCapacity: 8,
    startAt: '2026-07-05T10:00:00Z',
    endAt: '2026-07-05T12:00:00Z',
    status: 'assigned',
    staffId: 's1',
    staffName: 'Jip',
    hourlyRateCents: 3000, // €30/h → a 90-min gap ≈ €45, above the €20 floor
    category: 'shared',
    guestCount: 4,
    listingTitle: 'Canal Cruise',
    noRescheduleAsk: false,
    bookingId: null,
    availabilityPk: null,
    ...overrides,
  }
}

function booking(overrides: Partial<MoveBooking> & { id: string }): MoveBooking {
  return {
    category: 'shared',
    customerName: 'Lisa van Dijk',
    customerEmail: 'lisa@example.com',
    customerPhone: '+31600000000',
    extrasSelected: null,
    listingId: 'listing-1',
    listingTitle: 'Canal Cruise',
    guestCount: 4,
    totalCents: 12000,
    fareharborAvailabilityPk: null,
    noRescheduleAsk: false,
    ...overrides,
  }
}

/** Two sailings on one boat with a 90-min €45 gap; the later one owns booking b2. */
function gappyDay(b2Overrides: Partial<MoveBooking> = {}) {
  const b1 = booking({ id: 'b1' })
  const b2 = booking({ id: 'b2', ...b2Overrides })
  const shifts = [
    shift({ id: 'sh1', bookingId: 'b1' }),
    shift({ id: 'sh2', bookingId: 'b2', startAt: '2026-07-05T13:30:00Z', endAt: '2026-07-05T15:00:00Z' }),
  ]
  return { shifts, byId: new Map([['b1', b1], ['b2', b2]]), byPk: new Map() }
}

describe('selectMoveCandidate — the happy path', () => {
  it('proposes pulling the later sailing earlier, butted against the previous one', () => {
    const { shifts, byId, byPk } = gappyDay()
    const c = selectMoveCandidate(shifts, byId, byPk)

    expect(c).toBeTruthy()
    expect(c!.shiftId).toBe('sh2')
    expect(c!.bookingId).toBe('b2')
    expect(c!.proposedStartAt).toBe(new Date('2026-07-05T12:00:00Z').toISOString())
    // duration preserved: 90 min
    expect(c!.proposedEndAt).toBe(new Date('2026-07-05T13:30:00Z').toISOString())
    expect(c!.estSavingCents).toBe(4500)
  })

  it('a PRIVATE booking on the later sailing IS a valid candidate — same threshold as shared', () => {
    const { shifts, byId, byPk } = gappyDay({ category: 'private' }) // later = private
    const c = selectMoveCandidate(shifts, byId, byPk)

    expect(c).toBeTruthy()
    expect(c!.shiftId).toBe('sh2')
    expect(c!.bookingId).toBe('b2')
  })

  it('falls back to pushing the EARLIER sailing later when the later one is untouchable (no contact info)', () => {
    const { shifts, byId, byPk } = gappyDay({ customerEmail: null, customerPhone: null })
    const c = selectMoveCandidate(shifts, byId, byPk)

    expect(c).toBeTruthy()
    expect(c!.shiftId).toBe('sh1')
    // earlier shift (2h) moves so its end hits the later start: 11:30 → 13:30
    expect(c!.proposedStartAt).toBe(new Date('2026-07-05T11:30:00Z').toISOString())
  })
})

describe('selectMoveCandidate — the hard rules', () => {
  it('a PRIVATE booking is a valid candidate on both sides of the gap (Beer 2026-07-04)', () => {
    const { shifts, byId, byPk } = gappyDay({ category: 'private' })
    byId.set('b1', booking({ id: 'b1', category: 'private' }))
    const c = selectMoveCandidate(shifts, byId, byPk)
    expect(c).toBeTruthy()
    expect(c!.booking.category).toBe('private')
  })

  it('never asks a booking with catering/drinks aboard (Beer: supplier order already placed)', () => {
    const catering = [{ name: 'Unlimited Drinks Package', amount_cents: 4320, category: 'drinks', quantity: 4 }]
    const { shifts, byId, byPk } = gappyDay({ extrasSelected: catering as MoveBooking['extrasSelected'] })
    byId.set('b1', booking({ id: 'b1', extrasSelected: catering as MoveBooking['extrasSelected'] }))
    expect(selectMoveCandidate(shifts, byId, byPk)).toBeNull()
  })

  it('never asks when the departure carries MORE than one booking (sequential outreach)', () => {
    const b1 = booking({ id: 'b1' })
    const bA = booking({ id: 'bA', fareharborAvailabilityPk: 555 })
    const bB = booking({ id: 'bB', fareharborAvailabilityPk: 555 })
    const shifts = [
      shift({ id: 'sh1', bookingId: 'b1' }),
      shift({ id: 'sh2', bookingId: null, availabilityPk: 555, startAt: '2026-07-05T13:30:00Z', endAt: '2026-07-05T15:00:00Z' }),
    ]
    const byId = new Map([['b1', b1]])
    const byPk = new Map([[555, [bA, bB]]])
    // sh2 (two parties) is skipped; fallback tries sh1 which qualifies
    const c = selectMoveCandidate(shifts, byId, byPk)
    expect(c?.shiftId).toBe('sh1')

    // …and when sh1 is also untouchable (no contact info), nothing is proposed at all
    byId.set('b1', booking({ id: 'b1', customerEmail: null, customerPhone: null }))
    expect(selectMoveCandidate(shifts, byId, byPk)).toBeNull()
  })

  it('never asks a booking without email AND phone', () => {
    const { shifts, byId, byPk } = gappyDay({ customerEmail: null, customerPhone: null })
    byId.set('b1', booking({ id: 'b1', customerEmail: null, customerPhone: null }))
    expect(selectMoveCandidate(shifts, byId, byPk)).toBeNull()
  })

  it('never asks a booking flagged no_reschedule_ask — anniversary/birthday etc (Beer, 2026-08-23)', () => {
    const { shifts, byId, byPk } = gappyDay({ noRescheduleAsk: true })
    byId.set('b1', booking({ id: 'b1', noRescheduleAsk: true }))
    expect(selectMoveCandidate(shifts, byId, byPk)).toBeNull()
  })

  it('ignores gaps below the minute/€ thresholds — guests are not pestered for pennies', () => {
    const { byId, byPk } = gappyDay()
    const tightDay = [
      shift({ id: 'sh1', bookingId: 'b1' }),
      // 30-min gap < MIN_GAP_MINUTES
      shift({ id: 'sh2', bookingId: 'b2', startAt: '2026-07-05T12:30:00Z', endAt: '2026-07-05T14:00:00Z' }),
    ]
    expect(MIN_GAP_MINUTES).toBeGreaterThan(30)
    expect(selectMoveCandidate(tightDay, byId, byPk)).toBeNull()
  })

  it('an unassigned gap (no captain rate) has €0 saving and is not worth an ask', () => {
    const { byId, byPk } = gappyDay()
    const shifts = [
      shift({ id: 'sh1', bookingId: 'b1', staffId: null, staffName: null, hourlyRateCents: null, status: 'open' }),
      shift({ id: 'sh2', bookingId: 'b2', startAt: '2026-07-05T13:30:00Z', endAt: '2026-07-05T15:00:00Z' }),
    ]
    expect(selectMoveCandidate(shifts, byId, byPk)).toBeNull()
  })
})

describe('pickSnapSlot — snapping the geometric ideal to a real FH slot', () => {
  const ct = (over: Record<string, unknown> = {}) => ({
    pk: 555,
    boatId: 'diana' as const,
    durationMinutes: 90,
    minimumParty: 1,
    maximumParty: 12,
    priceCents: 3500,
    name: 'Adult (13+)',
    totalCapacity: 12,
    customerTypePk: 1,
    ...over,
  })
  const slot = (pk: number, startAt: string, cts = [ct()]) =>
    ({ pk, startAt, startTime: 'x', endAt: startAt, headline: '', capacity: 12, customerTypes: cts }) as never

  // Booking currently at 13:30; the gap math wants it at 12:00 (earlier move).
  const input = {
    currentStartAt: '2026-07-05T13:30:00Z',
    idealStartAt: '2026-07-05T12:00:00Z',
    durationMinutes: 90,
    boatKey: 'diana' as const,
    category: 'shared',
    guests: 4,
    hourlyRateCents: 3000,
  }

  it('snaps to the slot closest to the ideal within the window, recomputing the real saving', () => {
    const snap = pickSnapSlot(
      [slot(1, '2026-07-05T12:15:00Z'), slot(2, '2026-07-05T12:45:00Z')],
      input,
    )
    expect(snap).toBeTruthy()
    expect(snap!.availPk).toBe(1) // 12:15 is closest to the 12:00 ideal
    expect(snap!.recoveredMinutes).toBe(75) // 13:30 → 12:15
    expect(snap!.estSavingCents).toBe(3750) // 75 min at €30/h
    expect(snap!.snapped).toBe(true)
  })

  it('an exact match on the ideal is not "snapped"', () => {
    const snap = pickSnapSlot([slot(1, '2026-07-05T12:00:00Z')], input)
    expect(snap!.snapped).toBe(false)
  })

  it('ignores slots outside the window — earlier than the ideal or at/after the current time', () => {
    expect(pickSnapSlot([slot(1, '2026-07-05T11:00:00Z')], input)).toBeNull() // before ideal: worse than needed
    expect(pickSnapSlot([slot(1, '2026-07-05T13:30:00Z')], input)).toBeNull() // = current: moves nothing
    expect(pickSnapSlot([slot(1, '2026-07-05T14:30:00Z')], input)).toBeNull() // wrong direction
  })

  it('rejects a snap that no longer clears the ask thresholds (recovers too little)', () => {
    // 13:00 recovers only 30 min < MIN_GAP_MINUTES — not worth bothering a guest.
    expect(pickSnapSlot([slot(1, '2026-07-05T13:00:00Z')], input)).toBeNull()
  })

  it('filters on boat and duration — the ask promises "same boat, same cruise"', () => {
    expect(pickSnapSlot([slot(1, '2026-07-05T12:00:00Z', [ct({ boatId: 'curacao' })])], input)).toBeNull()
    expect(pickSnapSlot([slot(1, '2026-07-05T12:00:00Z', [ct({ durationMinutes: 120 })])], input)).toBeNull()
  })

  it('shared: party must fit; private: min/max 1/1 types are NOT party-filtered (you book the boat)', () => {
    const tiny = [slot(1, '2026-07-05T12:00:00Z', [ct({ maximumParty: 2 })])]
    expect(pickSnapSlot(tiny, input)).toBeNull() // 4 guests don't fit a max-2 type

    const privateBoat = [slot(1, '2026-07-05T12:00:00Z', [ct({ minimumParty: 1, maximumParty: 1 })])]
    expect(pickSnapSlot(privateBoat, { ...input, category: 'private' })).toBeTruthy()
  })

  it('handles the later-move direction (pushing the earlier sailing later)', () => {
    const laterInput = {
      ...input,
      currentStartAt: '2026-07-05T10:00:00Z',
      idealStartAt: '2026-07-05T11:30:00Z',
    }
    const snap = pickSnapSlot([slot(1, '2026-07-05T11:15:00Z')], laterInput)
    expect(snap).toBeTruthy()
    expect(snap!.recoveredMinutes).toBe(75)
  })
})
