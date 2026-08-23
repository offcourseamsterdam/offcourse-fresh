import { hasCatering, type ExtrasLineItem } from '@/lib/catering/filter'
import { shiftCostCents } from '@/lib/scheduling/shift-cost'

/**
 * Cross-day consolidation — the third kind of schedule optimization,
 * alongside ops-review.ts's same-day "gap between sailings" and "merge onto
 * another boat". Neither of those ever compares Tuesday's shift to
 * Wednesday's: a lone shared booking on each day looks normal in isolation
 * (one boat, one booking, nothing idle), so today's optimizer has no reason
 * to flag either one. The waste isn't idle minutes — it's a whole extra
 * boat-day for what one boat could carry.
 *
 * Beer, 2026-08-23 (real example, checked against prod): Paige Monacelli
 * (Tue 25 Aug, 4 guests) and Sophie Russell (Wed 26 Aug, 2 guests) were each
 * the ONLY booking on their shared departure — combined 6 guests fits
 * either boat's capacity, and neither shift even had a captain yet. Moving
 * one onto the other's departure frees a whole boat-day.
 *
 * See docs/plans/2026-08-23-cross-day-consolidation-optimizer.md for the
 * full design and the decisions this implements (±1 day window, same
 * product only, private cruises never eligible).
 */

export interface ConsolidationBooking {
  id: string
  category: string | null
  /** Same-product check — the ask promises "same boat, same cruise". */
  customerTypeName: string | null
  customerName: string | null
  customerEmail: string | null
  customerPhone: string | null
  guestCount: number | null
  totalCents: number | null
  fareharborAvailabilityPk: number | null
  extrasSelected: ExtrasLineItem[] | null
  listingTitle: string | null
  /** The booking's own departure window — NOT the shift's prep-to-wrap-up
   *  span. This is what the guest actually experiences and what the drafted
   *  message quotes. */
  startTime: string | null
  endTime: string | null
}

export interface ConsolidationShift {
  shiftId: string
  boat: string
  date: string
  startAt: string
  endAt: string
  hourlyRateCents: number | null
  bookings: ConsolidationBooking[]
}

export interface CrossDayConsolidationCandidate {
  /** The shift that would be eliminated entirely if the move is accepted. */
  fromShiftId: string
  fromDate: string
  /** The shift the booking would join instead. */
  toShiftId: string
  toDate: string
  boat: string
  /** The one booking being asked to move. */
  booking: ConsolidationBooking
  /** The booking already on the receiving departure — whose slot the moving guest would join. */
  receivingBooking: ConsolidationBooking
  combinedGuestCount: number
  capacity: number
  /** The full cost of the shift being eliminated — 0 when unassigned (no rate to price it by), never null (a candidate is still worth showing). */
  estSavingCents: number
}

function addDaysToDateStr(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

/**
 * A shift is a "moving" candidate only when moving it away would empty the
 * WHOLE shift — a single shared departure (one FareHarbor availability slot,
 * possibly several parties on it, but only one time/product), nobody's
 * catering already placed, category shared (private never merges — Beer,
 * 2026-07-04, enforced elsewhere too via deriveOperationalProfile.allowMerge).
 *
 * Multi-departure shifts (two different sailings that day on the same boat)
 * are skipped — moving one departure away wouldn't free the shift, and the
 * shift's own guest tally would no longer mean "the whole day's load".
 */
function asSingleDepartureShift(shift: ConsolidationShift): { booking: ConsolidationBooking; guestCount: number } | null {
  if (!shift.bookings.length) return null
  const pks = new Set(shift.bookings.map(b => b.fareharborAvailabilityPk))
  if (pks.size !== 1) return null
  if (shift.bookings.some(b => b.category !== 'shared')) return null
  if (shift.bookings.some(b => hasCatering(b.extrasSelected))) return null
  const productNames = new Set(shift.bookings.map(b => b.customerTypeName))
  if (productNames.size !== 1) return null
  const guestCount = shift.bookings.reduce((sum, b) => sum + (b.guestCount ?? 0), 0)
  // The representative booking for the ask — several bookings on one shared
  // slot is a real case (see 127_shift_bookings.sql), but this drafter only
  // ever asks ONE party at a time (same sequential rule guest-move-drafter
  // enforces); a multi-booking single-slot shift isn't a "moving" candidate
  // for the same reason a multi-booking single-slot day already isn't one in
  // selectMoveCandidate. A single-booking slot is required here.
  if (shift.bookings.length !== 1) return null
  return { booking: shift.bookings[0], guestCount }
}

export function findCrossDayConsolidationCandidates(
  shifts: ConsolidationShift[],
  boatCapacityByBoat: Record<string, number | null | undefined>,
): CrossDayConsolidationCandidate[] {
  // A boat has at most one shift per day ("one boat, one day, one shift" —
  // generate-shifts.ts), so a plain date map gives O(1) neighbor lookups
  // instead of a nested scan over every other shift on the boat.
  const byBoat = new Map<string, Map<string, ConsolidationShift>>()
  for (const s of shifts) {
    const byDate = byBoat.get(s.boat) ?? new Map<string, ConsolidationShift>()
    byDate.set(s.date, s)
    byBoat.set(s.boat, byDate)
  }

  const candidates: CrossDayConsolidationCandidate[] = []

  for (const [boat, byDate] of byBoat) {
    const capacity = boatCapacityByBoat[boat]
    if (capacity == null) continue

    // Always the LATER day's booking moving onto the EARLIER day's departure
    // (Beer's own example: Wednesday's guest joins Tuesday's) — a fixed
    // direction, not "whichever neighbor exists", so each adjacent pair
    // produces exactly one candidate instead of one from each shift's
    // perspective (which would say both "Tue could join Wed" and "Wed could
    // join Tue" for the same real pair).
    for (const [date, laterShift] of byDate) {
      const earlierShift = byDate.get(addDaysToDateStr(date, -1))
      if (!earlierShift) continue

      const movingInfo = asSingleDepartureShift(laterShift)
      if (!movingInfo) continue
      const receivingInfo = asSingleDepartureShift(earlierShift)
      if (!receivingInfo) continue
      if (receivingInfo.booking.customerTypeName !== movingInfo.booking.customerTypeName) continue

      const combinedGuestCount = movingInfo.guestCount + receivingInfo.guestCount
      if (combinedGuestCount > capacity) continue

      candidates.push({
        fromShiftId: laterShift.shiftId,
        fromDate: laterShift.date,
        toShiftId: earlierShift.shiftId,
        toDate: earlierShift.date,
        boat,
        booking: movingInfo.booking,
        receivingBooking: receivingInfo.booking,
        combinedGuestCount,
        capacity,
        estSavingCents: laterShift.hourlyRateCents != null ? shiftCostCents(laterShift.hourlyRateCents, laterShift.startAt, laterShift.endAt) : 0,
      })
    }
  }

  return candidates.sort((a, b) => b.estSavingCents - a.estSavingCents)
}
