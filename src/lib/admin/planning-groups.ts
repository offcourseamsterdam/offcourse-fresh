import type { AdminBooking } from './types'
import type { SharedCapacityResult } from './shared-capacity'

export interface PlanningGroup {
  key: string
  bookings: AdminBooking[]
  totalGuestCount: number
}

/**
 * Groups bookings that are really the same physical departure into one block —
 * same date, same start time, same listing, same category, same customer type
 * (boat + duration). Applies to both private and shared cruises: private
 * bookings almost always end up as a group of one (a private charter has no
 * sibling booking on the same slot), while a shared cruise with several
 * separate parties booked onto the same departure collapses into one group
 * with multiple bookings inside it.
 *
 * Grouped by `customer_type_name` (not the raw FareHarbor rate pk) — it's
 * already resolved server-side and two bookings sold the same product always
 * carry the identical name, so it's a reliable proxy without needing to widen
 * the AdminBooking type.
 *
 * Shared cruises key on `fareharbor_availability_pk` instead, when it's known
 * — the ONE identifier guaranteed to mean "the same real FareHarbor
 * departure" regardless of which virtual listing (see CLAUDE.md's Virtual
 * Product Layer) or import path a given booking came from. listing_id can
 * legitimately differ for two bookings on the exact same slot (two different
 * marketing pages pointing at one shared FareHarbor item), and a booking
 * imported straight from an OTA notification email (see
 * lib/fareharbor/import-booking.ts) never gets a listing_id or
 * customer_type_name at all — grouping those by the listing-based key alone
 * would always split them into their own single-booking card even when a
 * normal website booking exists on the identical slot.
 */
export function groupBookingsForPlanning(bookings: AdminBooking[]): PlanningGroup[] {
  const map = new Map<string, AdminBooking[]>()
  for (const b of bookings) {
    const key = b.category === 'shared' && b.fareharbor_availability_pk
      ? `avail::${b.fareharbor_availability_pk}`
      : [
          b.booking_date ?? '',
          b.start_time ?? '',
          b.listing_id ?? '',
          b.category ?? '',
          b.customer_type_name ?? '',
        ].join('::')
    const group = map.get(key)
    if (group) {
      group.push(b)
    } else {
      map.set(key, [b])
    }
  }

  return Array.from(map.entries()).map(([key, group]) => ({
    key,
    bookings: group,
    totalGuestCount: group.reduce((sum, b) => sum + (b.guest_count ?? 0), 0),
  }))
}

const KNOWN_BOATS = ['Diana', 'Curaçao'] as const

/**
 * Boat name parsed from a private-cruise customer type (e.g. "Diana - 2 Hours"
 * -> "Diana"). Private customer types are boat-prefixed by convention, so this
 * is a reliable signal for them.
 *
 * Shared cruises have NO boat/resource data available at all today — every
 * shared listing's `allowed_resource_pks` and the matching FareHarbor item's
 * `resources` are empty (verified against the live project), so a shared
 * booking's boat genuinely can't be determined from stored data. Returns null
 * for those rather than guessing; callers bucket null under "Other".
 */
export function extractBoatName(customerTypeName: string | null | undefined): string | null {
  if (!customerTypeName) return null
  const lower = customerTypeName.toLowerCase()
  for (const boat of KNOWN_BOATS) {
    if (lower.includes(boat.toLowerCase()) || (boat === 'Curaçao' && lower.includes('curacao'))) {
      return boat
    }
  }
  return null
}

/**
 * Boat for a departure group, name-based signal first (private cruises —
 * always reliable) falling back to the live FareHarbor capacity guess for
 * shared cruises (see shared-capacity.ts — matches the slot's full capacity
 * against a known boat's max guest count, e.g. 12 -> Curaçao). Both signals
 * are genuinely derived from data, not hardcoded — this just prefers the more
 * certain one when both could apply. Returns null (callers bucket under
 * "Other") when neither resolves, e.g. before the capacity fetch has loaded,
 * or when the slot's capacity doesn't cleanly match either boat.
 */
export function resolveBoatForGroup(
  group: PlanningGroup,
  sharedCapacity?: Record<number, SharedCapacityResult>
): string | null {
  const first = group.bookings[0]
  const nameBoat = extractBoatName(first?.customer_type_name)
  if (nameBoat) return nameBoat
  if (first?.category === 'shared' && first.fareharbor_availability_pk && sharedCapacity) {
    return sharedCapacity[first.fareharbor_availability_pk]?.boatGuess ?? null
  }
  return null
}

/**
 * Accent color for a boat's "truth-dot" time-connector and left-border on the
 * Planning time grid — one consistent color per boat, all week, so a reader
 * learns "indigo = Diana, pink = Curaçao" at a glance without a legend.
 * 'Other' (shared cruises — boat undetermined) gets a neutral zinc accent.
 */
export function boatAccentClasses(boat: string): { dot: string; border: string } {
  switch (boat) {
    case 'Diana':
      return { dot: 'bg-indigo-500', border: 'border-l-indigo-400' }
    case 'Curaçao':
      return { dot: 'bg-pink-500', border: 'border-l-pink-400' }
    default:
      return { dot: 'bg-zinc-400', border: 'border-l-zinc-300' }
  }
}

export interface BoatColumn {
  /** A known boat name, or 'Other' when it couldn't be determined (shared cruises today). */
  boat: string
  groups: PlanningGroup[]
}

/**
 * Splits a day's departure groups into one column per boat, so "Diana" and
 * "Curaçao" departures on the same day render side by side instead of mixed
 * into one list. Boats are sorted alphabetically; "Other" (undetermined —
 * shared cruises) always sorts last. Callers should skip the side-by-side
 * layout entirely when this returns 1 or fewer columns (nothing to split).
 *
 * `sharedCapacity`, once loaded, lets a shared cruise resolve into its real
 * boat's column instead of sitting in "Other" — see resolveBoatForGroup.
 */
export function splitGroupsByBoat(groups: PlanningGroup[], sharedCapacity?: Record<number, SharedCapacityResult>): BoatColumn[] {
  const map = new Map<string, PlanningGroup[]>()
  for (const group of groups) {
    const boat = resolveBoatForGroup(group, sharedCapacity) ?? 'Other'
    const bucket = map.get(boat)
    if (bucket) {
      bucket.push(group)
    } else {
      map.set(boat, [group])
    }
  }

  const boatNames = Array.from(map.keys()).sort((a, b) => {
    if (a === 'Other') return 1
    if (b === 'Other') return -1
    return a.localeCompare(b)
  })

  return boatNames.map(boat => ({ boat, groups: map.get(boat)! }))
}
