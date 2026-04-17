// ── Tracking event names (must match DB CHECK constraint) ──

export const TRACKING_EVENTS = [
  'page_view',
  'view_homepage',
  'view_cruise_detail',
  'view_booking_panel', // legacy, kept for backward compat
  'select_date',
  'select_time',
  'view_boat',          // private flow: choose boat + duration
  'view_tickets',       // shared flow: choose ticket types
  'no_availability',
  'view_checkout',      // legacy, kept for backward compat
  'view_payment',
  'view_extras',
  'view_details',
  'booking_completed',
] as const

export type TrackingEventName = (typeof TRACKING_EVENTS)[number]

// Funnel steps in display order (for the admin funnel chart)
// Clean funnel: homepage → cruise → date → time → extras → details → payment → booked
// no_availability is tracked but NOT a funnel step (it's a side branch)
// view_booking_panel removed (redundant — always fires with cruise detail)
// view_checkout removed (same as view_details)
export const FUNNEL_STEPS: { event: TrackingEventName; label: string }[] = [
  { event: 'view_homepage', label: 'Homepage' },
  { event: 'view_cruise_detail', label: 'Cruise Detail' },
  { event: 'select_date', label: 'Date Selected' },
  { event: 'select_time', label: 'Time Selected' },
  { event: 'view_boat', label: 'Boat / Tickets' },  // view_boat (private) or view_tickets (shared)
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

// ── Known UTM sources (auto-validated) ──
// Sources not on this list are still recorded but flagged as unverified.
// Campaign link slugs are also auto-validated server-side.

export const KNOWN_UTM_SOURCES = [
  // Search engines
  'google', 'bing', 'duckduckgo', 'yahoo', 'ecosia', 'baidu',
  // Social platforms
  'facebook', 'instagram', 'tiktok', 'linkedin', 'pinterest',
  'youtube', 'twitter', 'threads',
  // Email
  'email', 'newsletter', 'mailchimp', 'resend',
  // Partners / platforms
  'partner', 'withlocals', 'clickandboat', 'tripadvisor',
  'getyourguide', 'viator', 'airbnb',
  // Internal
  'direct', 'qr', 'print', 'flyer', 'merch',
]

// ── Social sources (used by attribution channel resolution) ──

export const SOCIAL_SOURCES = ['facebook', 'instagram', 'tiktok', 'twitter', 'linkedin', 'pinterest', 'youtube', 'threads']

// ── Rate limiting & debounce ──

export const DEBOUNCE_MS = 2000
export const RATE_LIMIT_SESSION = 60
export const RATE_LIMIT_EVENT = 120
export const RATE_LIMIT_WINDOW_MS = 60_000
export const UTM_MAX_LENGTH = 100
export const USER_AGENT_MAX_LENGTH = 500
