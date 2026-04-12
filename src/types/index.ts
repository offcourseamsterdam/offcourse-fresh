import type { Locale } from '@/lib/i18n/config'
import type { Database } from '@/lib/supabase/types'

// ── Availability ─────────────────────────────────────────────────────────────

export interface AvailabilitySlot {
  pk: number
  startTime: string   // HH:MM display string e.g. "14:00"
  startAt: string     // ISO datetime
  endAt: string
  headline: string
  customerTypes: AvailabilityCustomerType[]
  capacity: number    // max across customer type rates (≥1 = at least one option bookable)
}

export interface AvailabilityCustomerType {
  pk: number
  totalCapacity: number
  customerTypePk: number
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

export interface SearchResult {
  listing: Database['public']['Tables']['cruise_listings']['Row']
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
