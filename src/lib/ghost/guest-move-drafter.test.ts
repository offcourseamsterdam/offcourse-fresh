import { describe, it, expect } from 'vitest'
import { selectMoveCandidate, MIN_GAP_MINUTES, type MoveBooking } from './guest-move-drafter'
import type { OpsReviewShift } from './ops-review'

/**
 * The guest-outreach hard rules live in selectMoveCandidate, in code — these
 * tests pin them so a refactor can never quietly start texting the wrong
 * guests: private cruises, catering bookings (Beer 2026-07-04), multi-party
 * departures, and contactless bookings are all untouchable.
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
    listingTitle: 'Canal Cruise',
    guestCount: 4,
    totalCents: 12000,
    fareharborAvailabilityPk: null,
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

  it('falls back to pushing the EARLIER sailing later when the later one is untouchable', () => {
    const { shifts, byId, byPk } = gappyDay({ category: 'private' }) // later = private
    const c = selectMoveCandidate(shifts, byId, byPk)

    expect(c).toBeTruthy()
    expect(c!.shiftId).toBe('sh1')
    // earlier shift (2h) moves so its end hits the later start: 11:30 → 13:30
    expect(c!.proposedStartAt).toBe(new Date('2026-07-05T11:30:00Z').toISOString())
  })
})

describe('selectMoveCandidate — the hard rules', () => {
  it('never asks a PRIVATE booking (both sides private → no candidate)', () => {
    const { shifts, byId, byPk } = gappyDay({ category: 'private' })
    byId.set('b1', booking({ id: 'b1', category: 'private' }))
    expect(selectMoveCandidate(shifts, byId, byPk)).toBeNull()
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

    // …and when sh1 is also untouchable, nothing is proposed at all
    byId.set('b1', booking({ id: 'b1', category: 'private' }))
    expect(selectMoveCandidate(shifts, byId, byPk)).toBeNull()
  })

  it('never asks a booking without email AND phone', () => {
    const { shifts, byId, byPk } = gappyDay({ customerEmail: null, customerPhone: null })
    byId.set('b1', booking({ id: 'b1', customerEmail: null, customerPhone: null }))
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
