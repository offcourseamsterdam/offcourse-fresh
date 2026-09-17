/**
 * Minimal shape this predicate needs — a subset of AdminBooking. Kept in
 * sync with src/lib/admin/command-palette/sources/bookings.ts's
 * TEXT_COLUMNS — the two are separate search entry points (this page's own
 * search box vs. the Cmd+K palette) over the same table, and a field present
 * in one but not the other means the same query finds a booking one way but
 * not the other.
 */
export interface SearchableBooking {
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  listing_title: string | null
  tour_item_name: string | null
  booking_uuid: string | null
  stripe_payment_intent_id: string | null
  invoice_number?: string | null
  company_name?: string | null
}

/**
 * True when `query` matches this booking's guest, cruise, or reference ids.
 * Case-insensitive substring match. An empty/whitespace-only query always matches
 * (so the search box can be blank without hiding the whole list).
 */
export function matchesBookingSearch(booking: SearchableBooking, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true

  const haystack = [
    booking.customer_name,
    booking.customer_email,
    booking.customer_phone,
    booking.listing_title,
    booking.tour_item_name,
    booking.booking_uuid,
    booking.stripe_payment_intent_id,
    booking.invoice_number,
    booking.company_name,
  ]

  return haystack.some(field => field?.toLowerCase().includes(q))
}
