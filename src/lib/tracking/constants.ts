// ── Tracking event names (must match DB CHECK constraint) ──

export const TRACKING_EVENTS = [
  'page_view',
  'view_homepage',
  'view_cruise_detail',
  'view_booking_panel',
  'select_date',
  'select_time',
  'no_availability',
  'view_checkout',
  'view_payment',
  'view_extras',
  'view_details',
  'booking_completed',
] as const

export type TrackingEventName = (typeof TRACKING_EVENTS)[number]

// Funnel steps in display order (for the admin funnel chart)
export const FUNNEL_STEPS: { event: TrackingEventName; label: string }[] = [
  { event: 'view_homepage', label: 'Homepage' },
  { event: 'view_cruise_detail', label: 'Cruise Detail' },
  { event: 'view_booking_panel', label: 'Booking Panel' },
  { event: 'select_date', label: 'Date Selected' },
  { event: 'select_time', label: 'Time Selected' },
  { event: 'view_checkout', label: 'Checkout' },
  { event: 'view_extras', label: 'Extras' },
  { event: 'view_details', label: 'Details' },
  { event: 'view_payment', label: 'Payment' },
  { event: 'booking_completed', label: 'Booked' },
]

// ── Cookie configuration ──

export const COOKIE_VISITOR_ID = 'oc_vid'
export const COOKIE_SESSION_ID = 'oc_sid'
export const COOKIE_ATTRIBUTION = 'oc_attr'
export const COOKIE_CONSENT = 'oc_consent'

/** Visitor cookie lasts 1 year */
export const VISITOR_COOKIE_DAYS = 365
/** Attribution cookie lasts 30 days (first-touch window) */
export const ATTRIBUTION_COOKIE_DAYS = 30
/** Session expires after 30 minutes of inactivity */
export const SESSION_TIMEOUT_MINUTES = 30

// ── UTM parameter names ──

export const UTM_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const

export type UTMParams = {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
}
