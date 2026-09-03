/**
 * Shared booking money constants.
 *
 * Single source of truth for values that show up on legal/financial documents
 * (invoices, settlements) AND in the live pricing path. Keeping them here means
 * a rate change (e.g. the Amsterdam municipality raising the tourist tax) is one
 * edit, not a hunt across pricing, settlement, finance, and the invoice PDF.
 */

/** Amsterdam tourist/city tax — a per-guest municipal pass-through, 0% VAT. */
export const CITY_TAX_CENTS_PER_GUEST = 260

/**
 * Amsterdam's day-trip city tax exempts a company's first N guests each
 * calendar year, fleet-wide (not per boat). Confirmed with Beer 2026-09-02;
 * counting starts from calendar year 2026.
 */
export const CITY_TAX_FREE_GUESTS_PER_YEAR = 250

/** Dutch VAT rate applied to the cruise itself (the base fare). */
export const CRUISE_VAT_RATE = 9

/** Dutch VAT rate applied to food/drink extras. */
export const EXTRAS_VAT_RATE = 21

/**
 * Every value `bookings.status` is allowed to hold. The column itself is free
 * text (no DB constraint) — this is the single source of truth application code
 * must agree on. Enforced by src/lib/booking/booking-status-contract.test.ts,
 * which scans every route source file for `status: '...'` writes and
 * `.in('status', [...])` reads and fails the build if either uses a value not
 * listed here (2026-07: found and fixed exactly this — a listing-deletion safety
 * check filtered on 'pending', a value nothing ever writes; the real value is
 * 'pending_payment').
 */
export const BOOKING_STATUSES = [
  /** Payment-link booking created; awaiting the customer to pay. */
  'pending_payment',
  /** Stripe payment succeeded; FareHarbor booking not yet created (webhook parked it). */
  'paid_pending_fh',
  /** pending-fh-sweep's atomic in-progress claim while it retries FareHarbor. */
  'fh_in_progress',
  /** Fully booked — the terminal success state for every booking source. */
  'confirmed',
  /** Cancelled (customer, admin, or a detected refund). */
  'cancelled',
  /**
   * Legacy/external value — FareHarbor-webhook-imported platform bookings (e.g.
   * Viator/GetYourGuide reseller imports) are written directly at this status by
   * a process outside this app's own routes. Never written here; several readers
   * correctly treat it as equivalent to 'confirmed'.
   */
  'booked',
] as const

export type BookingStatus = typeof BOOKING_STATUSES[number]
