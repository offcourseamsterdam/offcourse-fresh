import type { ExtrasCalculation } from '@/lib/extras/calculate'

// ── FareHarbor API types ──────────────────────────────────────────────────

export interface Slot {
  pk: number
  start_at: string
  end_at: string
  capacity: number
  customer_type_rates: Rate[]
}

export interface Rate {
  pk: number
  capacity: number
  customer_type: { pk: number; singular: string; plural: string }
  customer_prototype?: { total: number; total_including_tax?: number }
}

export interface Listing {
  id: string
  title: string
  tagline: string | null
  slug: string
  category: string
  fareharbor_item_pk: number
  starting_price: number | null
  price_display: string | null
  hero_image_url: string | null
  departure_location: string | null
  slots: Slot[]
  slot_count: number
}

export interface Contact {
  name: string
  email: string
  phone: string
  note: string
}

// Stored in sessionStorage so state survives redirect-based payment methods (iDEAL etc.)
export interface PendingBooking {
  availPk: number
  customerTypeRatePk: number
  guestCount: number
  category: string
  contact: Contact
  selectedListing: Listing
  selectedSlot: Slot
  selectedRate: Rate
  date: string
  paymentIntentId: string
  // Extras
  selectedExtraIds: string[]
  extrasCalculation: ExtrasCalculation | null
}
