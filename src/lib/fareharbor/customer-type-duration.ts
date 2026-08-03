/**
 * Parses the duration (in minutes) encoded in a private-cruise customer type
 * name, e.g. "Diana - 2 Hours" -> 120, "Curaçao - 1.5 Hours" -> 90.
 *
 * FareHarbor customer_type_rate pks are minted per availability instance, not
 * a stable catalog entry — the same "Diana - 2 Hours" type carries a
 * different rate pk on every booking (verified against two real bookings for
 * the identical type: 8689979609 vs 8689979618). A pk-keyed duration lookup
 * (matching against a synced fareharbor_items.customer_types catalog) is
 * therefore stale the moment it's written; the customer type NAME is the one
 * stable signal, since it's snapshotted directly on the booking row at
 * creation time and always follows the "<Boat> - <N> Hour(s)" convention for
 * private cruises.
 *
 * Returns null when the name doesn't match that pattern (e.g. a shared
 * cruise's "Adult (13+)") — callers should leave end_time untouched in that
 * case. Shared cruises don't need this at all: FareHarbor already returns a
 * genuinely distinct start/end for shared availability (the same-time quirk
 * this function's output is used to correct is private-only).
 */
export function parseDurationMinutesFromCustomerTypeName(name: string | null | undefined): number | null {
  if (!name) return null
  const match = name.match(/(\d+(?:\.\d+)?)\s*hours?/i)
  if (!match) return null
  const hours = parseFloat(match[1])
  if (!Number.isFinite(hours) || hours <= 0) return null
  return Math.round(hours * 60)
}
