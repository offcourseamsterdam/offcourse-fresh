import type { AdminBooking } from './types'

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
 */
export function groupBookingsForPlanning(bookings: AdminBooking[]): PlanningGroup[] {
  const map = new Map<string, AdminBooking[]>()
  for (const b of bookings) {
    const key = [
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
 */
export function splitGroupsByBoat(groups: PlanningGroup[]): BoatColumn[] {
  const map = new Map<string, PlanningGroup[]>()
  for (const group of groups) {
    const boat = extractBoatName(group.bookings[0]?.customer_type_name) ?? 'Other'
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
