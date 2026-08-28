/**
 * The FareHarbor "New Booking" notification email (and the equivalent
 * webhook payload) carry no explicit private/shared flag — only the item's
 * display name ("Shared Cruise", "Private Cruise (Diana, 2h)", etc.), same
 * wording the booking-flow route's own listing titles use. Without this,
 * category stays null and Planning's DepartureBlock renders "—" instead of
 * "Shared"/"Private" — cosmetic on its own, but it also gates the "X spots
 * left" capacity badge, which only renders for category==='shared'.
 *
 * Shared between two independently-deployed runtimes that both insert
 * `bookings` rows from a FareHarbor payload: the Next.js app
 * (src/lib/fareharbor/import-booking.ts) and this Edge Function
 * (fareharbor-webhook/index.ts) — a single copy here means they can't
 * silently drift into deriving a different category for the same
 * experience name.
 */
export function categoryFromExperienceName(experienceName: string | null | undefined): 'private' | 'shared' | null {
  if (!experienceName) return null
  const lower = experienceName.toLowerCase()
  if (lower.includes('shared')) return 'shared'
  if (lower.includes('private')) return 'private'
  return null
}
