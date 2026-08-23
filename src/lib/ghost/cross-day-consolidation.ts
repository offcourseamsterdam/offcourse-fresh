import { hasFood, type ExtrasLineItem } from '@/lib/catering/filter'
import { shiftCostCents } from '@/lib/scheduling/shift-cost'
import { buildBlocks } from '@/lib/scheduling/generate-shifts'
import { CROSS_DAY_WINDOW_DAYS } from './rulebook'

/**
 * Cross-day consolidation — the third kind of schedule optimization,
 * alongside ops-review.ts's same-day "gap between sailings" and "merge onto
 * another boat". Neither of those ever compares Tuesday's shift to
 * Wednesday's: a lone shared booking on each day looks normal in isolation
 * (one boat, one booking, nothing idle), so today's optimizer has no reason
 * to flag either one.
 *
 * Beer, 2026-08-23 (real example, checked against prod): Paige Monacelli
 * (Tue 25 Aug, 4 guests) and Sophie Russell (Wed 26 Aug, 2 guests) were each
 * the ONLY booking on their shared departure — combined 6 guests fits
 * either boat's capacity. Moving one onto the other's departure saves real
 * captain time.
 *
 * Beer, 2026-08-23 (a second real correction, same day): the saving isn't
 * only "the whole shift disappears" — it also counts when a shift merely
 * SHRINKS. "One boat, one day, one shift" means a shift's price is its full
 * prep-to-wrap-up span (see generate-shifts.ts), not per departure. If
 * Wednesday's Curaçao shift also covers an unrelated private cruise, moving
 * Sophie's shared departure away doesn't free the whole shift — but it can
 * still shorten it (less prep-to-wrap-up to pad around, or one less leg
 * pushing the wrap-up time later), and that shorter span costs less. This
 * file prices whichever is actually true — full elimination when a
 * departure was the shift's only one, a shrink when it wasn't — by
 * re-running the SAME block-boundary math generate-shifts.ts already uses,
 * once with the departure and once without it, and pricing the difference.
 *
 * See docs/plans/2026-08-23-cross-day-consolidation-optimizer.md for the
 * full design and the decisions this implements (±1 day window, same
 * product only, private cruises never eligible to move or merge).
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
  /** Admin-set "never propose a move on this one" (Beer, 2026-08-23: anniversary/birthday bookings). */
  noRescheduleAsk: boolean
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
  /** The shift the moving departure currently belongs to — shrinks or, if
   *  that departure was its only one, disappears entirely. */
  fromShiftId: string
  fromDate: string
  /** The shift the booking would join instead. Never changes cost — the
   *  guest joins an existing departure at its existing time. */
  toShiftId: string
  toDate: string
  boat: string
  /** The one booking being asked to move. */
  booking: ConsolidationBooking
  /** The booking already on the receiving departure — whose slot the moving guest would join. */
  receivingBooking: ConsolidationBooking
  combinedGuestCount: number
  capacity: number
  /** 0 when the moving shift is unassigned (no rate to price it by) — never
   *  null, a candidate is still worth showing even unpriced. */
  estSavingCents: number
  /** True when the moving departure was its shift's only one, so the whole
   *  fromShiftId shift disappears. False means the shift merely shrinks
   *  around whatever else stays behind (see the file doc comment) — callers
   *  building user-facing copy must not say "frees the shift" in that case. */
  eliminatesShift: boolean
}

function addDaysToDateStr(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

/** One real departure on a shift — bookings sharing a FareHarbor slot, or
 *  (no slot, e.g. a private cruise) one booking standing alone. Mirrors
 *  generate-shifts.ts's own departure-grouping key exactly, since this is
 *  the same real-world concept: "how many distinct sailings does this boat
 *  make today". */
interface DepartureGroup {
  bookings: ConsolidationBooking[]
  guestCount: number
  startTime: string | null
  endTime: string | null
}

function departureGroups(shift: ConsolidationShift): DepartureGroup[] {
  const byKey = new Map<string, ConsolidationBooking[]>()
  for (const b of shift.bookings) {
    const key = b.fareharborAvailabilityPk != null ? `pk:${b.fareharborAvailabilityPk}` : `booking:${b.id}`
    const list = byKey.get(key) ?? []
    list.push(b)
    byKey.set(key, list)
  }
  return Array.from(byKey.values()).map(bookings => ({
    bookings,
    guestCount: bookings.reduce((sum, b) => sum + (b.guestCount ?? 0), 0),
    startTime: bookings[0].startTime,
    endTime: bookings[0].endTime,
  }))
}

/**
 * Eligible to be ASKED TO MOVE: exactly one booking (this drafter only ever
 * asks one party at a time — same sequential rule guest-move-drafter.ts
 * enforces), shared category (private never merges — Beer, 2026-07-04,
 * enforced elsewhere too via deriveOperationalProfile.allowMerge), no FOOD
 * order placed (drinks-only is fine — see the file doc comment), and not
 * admin-flagged no_reschedule_ask (Beer, 2026-08-23: anniversary/birthday
 * bookings).
 */
function eligibleToMove(group: DepartureGroup): boolean {
  if (group.bookings.length !== 1) return false
  const b = group.bookings[0]
  return b.category === 'shared' && !hasFood(b.extrasSelected) && !b.noRescheduleAsk
}

/**
 * What the shift would cost if `remove` were dropped from it — the real
 * generate-shifts.ts block-boundary math (prep-before-first, wrap-after-
 * last), re-run on whatever departures are left. `null` means the shift
 * disappears entirely (it had no other departures) rather than shrinking.
 */
function spanWithoutGroup(
  shift: ConsolidationShift,
  allGroups: DepartureGroup[],
  remove: DepartureGroup,
): { startAt: string; endAt: string } | null {
  // `allGroups` must be the SAME array `remove` came from — a fresh
  // departureGroups(shift) call here would produce new objects every time,
  // and `g !== remove` would never match anything (reference equality on
  // objects nobody kept), silently including the group meant to be removed.
  const remaining = allGroups.filter(g => g !== remove)
  if (!remaining.length) return null
  const departures = remaining.map(g => ({
    bookingIds: g.bookings.map(b => b.id),
    start: g.startTime ?? shift.startAt,
    end: g.endTime ?? shift.endAt,
    date: shift.date,
    // Grouping key only (buildBlocks groups by date::boatId) — every
    // departure here is already known to be the same shift, same boat.
    boatId: shift.shiftId,
    fhPk: null,
    boatAuthoritative: true,
  }))
  const [block] = buildBlocks(departures)
  return { startAt: block.start_at, endAt: block.end_at }
}

/** The real saving from moving `group` off `shift` — the shift's current
 *  cost minus whatever it costs (or 0, if it disappears) without that one
 *  departure. Unassigned shifts (no rate to price by) still surface as a
 *  candidate, priced at 0 rather than excluded. */
function movingSavingCents(shift: ConsolidationShift, allGroups: DepartureGroup[], group: DepartureGroup): number {
  if (shift.hourlyRateCents == null) return 0
  const before = shiftCostCents(shift.hourlyRateCents, shift.startAt, shift.endAt)
  const without = spanWithoutGroup(shift, allGroups, group)
  const after = without ? shiftCostCents(shift.hourlyRateCents, without.startAt, without.endAt) : 0
  return Math.max(0, before - after)
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

    // Checks EXACTLY CROSS_DAY_WINDOW_DAYS apart, not "anywhere within" it —
    // fine at the current value of 1 (there's no day in between to miss).
    // Raising it later to admit a real range (e.g. 1 OR 2 days apart) needs
    // this loop widened to check every offset up to the window, not just
    // reading a bigger single offset.
    //
    // Driven by iterating the LATER of each pair (so every adjacent pair is
    // visited exactly once, never once from each side) — which specific
    // eligible departure actually moves is decided below, by party size,
    // independently for each eligible-group pairing across the two shifts.
    for (const [date, laterShift] of byDate) {
      const earlierShift = byDate.get(addDaysToDateStr(date, -CROSS_DAY_WINDOW_DAYS))
      if (!earlierShift) continue

      // Full membership (not just the eligible ones) — movingSavingCents
      // needs the WHOLE list to correctly compute "the shift without this
      // one departure" when some other, ineligible departure stays behind.
      const laterAllGroups = departureGroups(laterShift)
      const earlierAllGroups = departureGroups(earlierShift)
      const laterGroups = laterAllGroups.filter(eligibleToMove)
      const earlierGroups = earlierAllGroups.filter(eligibleToMove)

      // Every eligible departure on the later day, paired with every
      // eligible departure on the earlier day — in practice almost always
      // 1×1 (a boat rarely runs two shared departures the same day), but a
      // multi-departure day is real (see the file doc comment), so this
      // doesn't assume a shift has only one eligible group.
      for (const laterGroup of laterGroups) {
        for (const earlierGroup of earlierGroups) {
          const laterBooking = laterGroup.bookings[0]
          const earlierBooking = earlierGroup.bookings[0]
          if (laterBooking.customerTypeName !== earlierBooking.customerTypeName) continue

          const combinedGuestCount = laterGroup.guestCount + earlierGroup.guestCount
          if (combinedGuestCount > capacity) continue

          // Ask whichever party is SMALLER to move (Beer, 2026-08-23:
          // smaller groups tend to be more flexible) — not a fixed "later
          // always moves". A tie keeps the simpler default: later moves.
          const laterMoves = laterGroup.guestCount <= earlierGroup.guestCount
          const moving = laterMoves
            ? { shift: laterShift, allGroups: laterAllGroups, group: laterGroup, booking: laterBooking }
            : { shift: earlierShift, allGroups: earlierAllGroups, group: earlierGroup, booking: earlierBooking }
          const receiving = laterMoves
            ? { shift: earlierShift, booking: earlierBooking }
            : { shift: laterShift, booking: laterBooking }

          candidates.push({
            fromShiftId: moving.shift.shiftId,
            fromDate: moving.shift.date,
            toShiftId: receiving.shift.shiftId,
            toDate: receiving.shift.date,
            boat,
            booking: moving.booking,
            receivingBooking: receiving.booking,
            combinedGuestCount,
            capacity,
            estSavingCents: movingSavingCents(moving.shift, moving.allGroups, moving.group),
            eliminatesShift: moving.allGroups.length === 1,
          })
        }
      }
    }
  }

  return candidates.sort((a, b) => b.estSavingCents - a.estSavingCents)
}
