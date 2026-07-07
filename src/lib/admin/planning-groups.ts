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
