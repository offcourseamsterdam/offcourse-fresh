import type { Locale } from '@/lib/i18n/config'

// ── Availability ─────────────────────────────────────────────────────────────

export interface AvailabilitySlot {
  pk: number
  startTime: string   // HH:MM display string e.g. "14:00"
  startAt: string     // ISO datetime
  endAt: string
  headline: string
  customerTypes: AvailabilityCustomerType[]
  capacity: number    // max across customer type rates (≥1 = at least one option bookable)
  callToBook?: boolean // true when slot is past cutoff with no prior bookings → show WhatsApp CTA
}

export interface AvailabilityCustomerType {
  pk: number
  totalCapacity: number
  customerTypePk: number
  /** FH-provided name e.g. "Adult (13+)" / "Child (0-12)". May be empty if FH didn't supply one. */
  name: string
  boatId: 'diana' | 'curacao'
  minimumParty: number
  maximumParty: number
  priceCents: number
  durationMinutes: number
}

// ── Search ───────────────────────────────────────────────────────────────────

export interface SearchParams {
  date: string   // YYYY-MM-DD
  guests: number
  locale: Locale
}

/** Narrow listing shape returned in search results — only what the UI actually needs. */
export interface SearchListingRow {
  id: string
  slug: string
  title: string
  tagline: string | null
  category: string
  hero_image_url: string | null
  starting_price: number | null
  price_display: string | null
  price_label: string | null
  departure_location: string | null
}

export interface SearchResult {
  listing: SearchListingRow
  availableSlots: AvailabilitySlot[]
  date: string
  guests: number
}

// ── Booking ──────────────────────────────────────────────────────────────────

export interface BookingState {
  listingSlug: string
  availabilityPk: number
  customerTypePk: number
  guestCount: number
  date: string
  startAt: string
  totalCents: number
}

export interface CustomerDetails {
  name: string
  email: string
  phone?: string
  specialRequests?: string
}
