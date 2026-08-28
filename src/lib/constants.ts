// ── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_DURATION_MINUTES = 90

// ── Extras categories ────────────────────────────────────────────────────────

export const CATEGORY_EMOJI: Record<string, string> = {
  food: '🍽️',
  drinks: '🥂',
  protection: '🛡️',
  experience: '✨',
  tax: '🏛️',
  info: 'ℹ️',
}

export const EXTRAS_CATEGORIES = ['food', 'drinks', 'protection', 'experience', 'tax', 'info'] as const
export type ExtrasCategory = (typeof EXTRAS_CATEGORIES)[number]

// ── Extras pricing ──────────────────────────────────────────────────────────

export const PRICE_TYPES = [
  { value: 'fixed_cents', label: 'Fixed price' },
  { value: 'percentage', label: 'Percentage (%)' },
  { value: 'per_person_cents', label: 'Per person' },
  { value: 'per_person_per_hour_cents', label: 'Per person per hour' },
  { value: 'informational', label: 'Info only (no charge)' },
] as const

export const VAT_RATES = [0, 9, 21] as const

/** Format an extra's price for display in admin UI */
export function formatExtraPrice(extra: { price_type: string; price_value: number }): string {
  if (extra.price_type === 'informational') return 'Info only'
  if (extra.price_type === 'percentage') return `${extra.price_value}%`
  if (extra.price_type === 'per_person_cents') return `€${(extra.price_value / 100).toFixed(2)}/person`
  if (extra.price_type === 'per_person_per_hour_cents') return `€${(extra.price_value / 100).toFixed(2)}/person/hour`
  return `€${(extra.price_value / 100).toFixed(2)}`
}

// ── Listing categories ────────────────────────────────────────────────���─────

export const LISTING_CATEGORIES = ['private', 'shared', 'standard', 'special', 'seasonal', 'event'] as const
export type ListingCategory = (typeof LISTING_CATEGORIES)[number]

// ── Booking sources ─────────────────────────────────────────────────────────

export const BOOKING_SOURCES = [
  { value: 'website', label: 'Website (regular)', adminSelectable: true },
  { value: 'complimentary', label: 'Complimentary', adminSelectable: true },
  { value: 'withlocals', label: 'Withlocals', adminSelectable: true },
  { value: 'clickandboat', label: 'Click&Boat', adminSelectable: true },
  { value: 'getyourguide', label: 'GetYourGuide', adminSelectable: true },
  { value: 'tripadvisor', label: 'TripAdvisor', adminSelectable: true },
  { value: 'boatlocal', label: 'Boat Local', adminSelectable: true },
  // A phone call or walk-in someone typed straight into the FareHarbor
  // dashboard — never touched our own checkout, so it needs an honest label
  // instead of being lumped in with real website bookings.
  { value: 'phone_walkin', label: 'Phone / walk-in', adminSelectable: true },
  // Public-only: the Webikeamsterdam QR checkout (customer types a partner code,
  // no admin session). Not admin-selectable — an admin has no code to enter and
  // this flow is validated entirely by resolvePartnerInvoiceContext(). Admins who
  // want to record a booking against a partner for later invoicing should use
  // "Invoice later" instead.
  { value: 'partner_invoice', label: 'Partner invoice', adminSelectable: false },
  // Admin-only: staff picks an existing partner directly, no code needed. The
  // suggested invoice amount is computed from an active campaign's commission %
  // when one exists for that partner+listing, editable either way.
  { value: 'invoice_later', label: 'Invoice later', adminSelectable: true },
  { value: 'payment_link', label: 'Betaallink', adminSelectable: true },
  { value: 'stripe_recovery', label: 'Stripe recovery (already paid)', adminSelectable: true },
] as const

export type BookingSource = typeof BOOKING_SOURCES[number]['value']

/**
 * Sources where a 3rd-party platform is the merchant of record and holds the
 * customer relationship — we can read these bookings but must not unilaterally
 * cancel/reschedule/refund them on our side; that has to happen on the
 * platform and sync back. Shared by the admin bookings UI and the Ghost
 * cancellation agent so the boundary can't drift between the two.
 */
export const OTA_BOOKING_SOURCES: BookingSource[] = ['tripadvisor', 'getyourguide', 'withlocals', 'clickandboat', 'boatlocal']

// ── Session storage keys ────────────────────────────────────────────────────

export const SESSION_BOOKING_KEY = 'offcourse_booking'
export const SESSION_CONTACT_KEY = 'offcourse_contact'
