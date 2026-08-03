/**
 * Parses the guest capacity encoded in a private-boat customer type's free-text
 * note, e.g. "Up to 8 people" -> 8. This is the ONLY place a private boat's
 * real max guest count exists as data anywhere in FareHarbor's API — there is
 * no numeric "resources" or capacity field for it (see
 * fareharbor-no-resource-field memory / docs/features). `customer_type_rate`
 * and `customer_type_rate.capacity` are a 0/1 slot-availability flag for
 * private cruises, not a guest count.
 *
 * Returns null when the note doesn't match the pattern (e.g. a shared cruise's
 * age-bracket note "13+ years").
 */
export function parseCapacityFromNote(note: string | null | undefined): number | null {
  if (!note) return null
  const match = note.match(/up to\s+(\d+)\s*people/i)
  if (!match) return null
  const capacity = parseInt(match[1], 10)
  if (!Number.isFinite(capacity) || capacity <= 0) return null
  return capacity
}
