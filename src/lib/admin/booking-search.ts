/** Minimal shape this predicate needs — a subset of AdminBooking. */
export interface SearchableBooking {
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  listing_title: string | null
  tour_item_name: string | null
  booking_uuid: string | null
  stripe_payment_intent_id: string | null
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
  ]

  return haystack.some(field => field?.toLowerCase().includes(q))
}
