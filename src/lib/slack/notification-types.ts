/**
 * THE CATALOG OF EVERY SLACK NOTIFICATION THIS APP CAN SEND.
 *
 * Why this file exists
 * --------------------
 * Slack messages used to be written inline at ~25 different call sites, which meant
 * nobody — not even the code — had a list of what the app can shout about. This
 * registry is that list: one entry per notification type, with the human-readable
 * explanation of what makes it fire and what to do when you see it.
 *
 * It does three jobs at once:
 *   1. Typing — `SlackNotificationKind` is derived from this array, so passing an
 *      unknown `kind` to postSlackText() is a COMPILE error, not a silent typo.
 *   2. Logging — every message sent is written to the `slack_notifications` table
 *      tagged with its kind, so the admin dashboard can group and filter them.
 *   3. Documentation — /admin/notifications/types renders this array directly.
 *      Add an entry here and the docs page updates itself.
 *
 * This module is deliberately dependency-free (no Supabase, no `server-only`) so
 * the admin UI can import it in the browser.
 */

export type SlackNotificationCategory =
  | 'bookings'
  | 'payments'
  | 'catering'
  | 'operations'
  | 'marketing'
  | 'system'

/**
 * How loud a notification is:
 *  - success  — something good happened, no action needed
 *  - info     — FYI, no action needed
 *  - warning  — worth a look soon
 *  - critical — money or a customer is affected right now; act immediately
 */
export type SlackNotificationSeverity = 'success' | 'info' | 'warning' | 'critical'

/**
 * Where the message lands:
 *  - channel        — the shared alerts channel (SLACK_WEBHOOK_URL)
 *  - dm             — Beer's DM only, never the shared channel
 *  - dm-or-channel  — tries Beer's DM first, falls back to the channel if
 *                     SLACK_BOT_TOKEN isn't configured (postSlackCritical)
 */
export type SlackNotificationDestination = 'channel' | 'dm' | 'dm-or-channel'

export interface SlackNotificationType {
  /** Stable machine id, `domain.event`. Stored in the DB — never rename casually. */
  kind: string
  /** Human title shown in the admin UI. */
  label: string
  category: SlackNotificationCategory
  severity: SlackNotificationSeverity
  destination: SlackNotificationDestination
  /** Plain English: what makes this message fire. */
  trigger: string
  /** Plain English: what a human should do when it lands. */
  action: string
  /** Where in the codebase it is sent from (path, for whoever goes looking). */
  source: string
}

export const SLACK_NOTIFICATION_TYPES = [
  // ── Bookings ──────────────────────────────────────────────────────────────
  {
    kind: 'booking.created',
    label: 'New booking confirmed',
    category: 'bookings',
    severity: 'success',
    destination: 'channel',
    trigger:
      'A booking was successfully created and saved — a customer checkout confirmed by the Stripe webhook, or an internal / partner-invoice / invoice-later booking made from the admin booking flow.',
    action: 'None. This is the happy path — the money-in message.',
    source: 'api/webhooks/stripe/route.ts · api/admin/booking-flow/book/route.ts',
  },
  {
    kind: 'booking.payment_link_created',
    label: 'Payment-link booking confirmed',
    category: 'bookings',
    severity: 'success',
    destination: 'channel',
    trigger:
      'A customer paid a Stripe payment link (checkout.session.completed) and the pre-created booking flipped to confirmed.',
    action: 'None — the confirmation email goes out automatically.',
    source: 'api/webhooks/stripe/route.ts',
  },
  {
    kind: 'booking.payment_link_expired',
    label: 'Payment link expired',
    category: 'bookings',
    severity: 'info',
    destination: 'channel',
    trigger:
      'A Stripe payment link expired unpaid (checkout.session.expired). The held FareHarbor slot is released automatically.',
    action: 'None, unless you want to chase the customer with a fresh link.',
    source: 'api/webhooks/stripe/route.ts',
  },
  {
    kind: 'booking.cancelled_admin',
    label: 'Booking cancelled (admin)',
    category: 'bookings',
    severity: 'info',
    destination: 'channel',
    trigger: 'Someone cancelled a booking from the admin bookings table, with or without a refund.',
    action: 'None — the audit trail. Refund amount is in the message.',
    source: 'api/admin/bookings/[id]/cancel/route.ts',
  },
  {
    kind: 'booking.rescheduled_admin',
    label: 'Booking rescheduled (admin)',
    category: 'bookings',
    severity: 'info',
    destination: 'channel',
    trigger: 'A booking was moved to a new date/time from the admin bookings table (rebook).',
    action: 'None — the reschedule email is sent separately.',
    source: 'api/admin/bookings/[id]/rebook/route.ts',
  },

  // ── Payments ──────────────────────────────────────────────────────────────
  {
    kind: 'payment.failed',
    label: 'Payment failed',
    category: 'payments',
    severity: 'info',
    destination: 'channel',
    trigger:
      'A card was declined or an iDEAL payment was rejected (payment_intent.payment_failed). The customer sees the error in their browser.',
    action:
      'Nothing required — no customer is stranded. Useful as a signal if failures suddenly spike (a broken payment method).',
    source: 'api/webhooks/stripe/route.ts',
  },
  {
    kind: 'payment.refunded',
    label: 'Refund issued',
    category: 'payments',
    severity: 'info',
    destination: 'channel',
    trigger: 'Stripe reported a full or partial refund on a charge (charge.refunded).',
    action: 'None — the Google Ads conversion value is adjusted down automatically.',
    source: 'api/webhooks/stripe/route.ts',
  },
  {
    kind: 'payment.chargeback',
    label: 'Chargeback opened',
    category: 'payments',
    severity: 'critical',
    destination: 'channel',
    trigger: 'A customer disputed a charge with their bank (charge.dispute.created).',
    action:
      'Respond in the Stripe dashboard within 7 days with evidence, or the dispute is auto-lost and the money goes back.',
    source: 'api/webhooks/stripe/route.ts',
  },

  // ── Catering ──────────────────────────────────────────────────────────────
  {
    kind: 'catering.order_received',
    label: 'New catering order — review needed',
    category: 'catering',
    severity: 'warning',
    destination: 'channel',
    trigger:
      'A booking came in with food on it. Fires as URGENT when the cruise departs within 24 hours.',
    action: 'Open Admin → Catering and confirm the order before the supplier deadline.',
    source: 'lib/catering/notify.ts',
  },
  {
    kind: 'catering.sent_to_supplier',
    label: 'Catering order sent to supplier',
    category: 'catering',
    severity: 'success',
    destination: 'channel',
    trigger:
      'The catering email actually went out to the supplier — automatically inside the 7-day window, or manually resent from admin.',
    action: 'None. The FareHarbor booking note is updated with the same details.',
    source: 'lib/catering/send-catering-email.ts',
  },
  {
    kind: 'catering.preorder_added',
    label: 'New catering pre-order (upsell)',
    category: 'catering',
    severity: 'info',
    destination: 'channel',
    trigger:
      'An already-booked customer added food via the pre-cruise extras upsell page. Drinks-only additions stay silent.',
    action: 'Check it lands with the supplier if the cruise is close.',
    source: 'api/booking/extras/[id]/route.ts',
  },

  // ── Operations / recovery ────────────────────────────────────────────────
  {
    kind: 'sweep.booking_completed',
    label: 'Parked booking completed by sweep',
    category: 'operations',
    severity: 'success',
    destination: 'channel',
    trigger:
      'The pending-fh-sweep cron picked up a paid-but-unbooked cruise and finished the FareHarbor booking itself.',
    action:
      'None — the safety net worked. The confirmation email and catering the webhook never sent go out here too.',
    source: 'api/cron/pending-fh-sweep/route.ts',
  },
  {
    kind: 'sweep.refund_cancelled',
    label: 'Parked booking cancelled — already refunded',
    category: 'operations',
    severity: 'info',
    destination: 'channel',
    trigger:
      'The sweep found a refund on a parked payment and cancelled the row instead of booking it — never book a payment a human already gave back.',
    action: 'None. Confirms the refund guard did its job.',
    source: 'api/cron/pending-fh-sweep/route.ts',
  },
  {
    kind: 'sweep.paid_but_unbooked',
    label: 'PAID BUT UNBOOKED',
    category: 'operations',
    severity: 'critical',
    destination: 'dm-or-channel',
    trigger:
      'A cruise has been paid for over 30 minutes and the sweep still cannot create the FareHarbor booking. Fires exactly once per booking.',
    action:
      'Create the FareHarbor booking by hand and flip the row to confirmed. Do NOT refund — the customer expects to sail.',
    source: 'api/cron/pending-fh-sweep/route.ts',
  },
  {
    kind: 'sweep.query_failed',
    label: 'Sweep could not reach the database',
    category: 'operations',
    severity: 'critical',
    destination: 'dm-or-channel',
    trigger: 'The pending-fh-sweep cron could not query Supabase, so the recovery net did not run at all.',
    action: 'Check Supabase status. Any paid-but-unbooked cruise is currently unattended.',
    source: 'api/cron/pending-fh-sweep/route.ts',
  },
  {
    kind: 'booking.webhook_failed',
    label: 'CRITICAL: webhook booking failed',
    category: 'operations',
    severity: 'critical',
    destination: 'dm-or-channel',
    trigger:
      'Stripe confirmed the money but the webhook could not complete the booking in FareHarbor or Supabase.',
    action:
      'Check the bookings table and FareHarbor first — if a booking exists this is a false alarm. Otherwise recreate it via Admin → FareHarbor flow with the "Stripe recovery" source.',
    source: 'api/webhooks/stripe/route.ts',
  },
  {
    kind: 'booking.db_save_failed',
    label: 'CRITICAL: booking not saved to database',
    category: 'operations',
    severity: 'critical',
    destination: 'dm-or-channel',
    trigger:
      'The cruise was paid for AND booked in FareHarbor, but the row failed to save in Supabase. The full payload is attached to the message.',
    action:
      'Recreate the booking row from the attached JSON so it shows up in admin, planning and finance.',
    source: 'api/admin/booking-flow/book/route.ts',
  },
  {
    kind: 'booking.payment_link_db_failed',
    label: 'Payment-link booking not confirmed in database',
    category: 'operations',
    severity: 'critical',
    destination: 'channel',
    trigger:
      'A payment link was paid, but the booking status could not be flipped to confirmed in Supabase.',
    action: 'Flip the status to confirmed in Supabase by hand and verify the FareHarbor booking exists.',
    source: 'api/webhooks/stripe/route.ts',
  },
  {
    kind: 'booking.failure_report',
    label: 'Booking flow failure report',
    category: 'operations',
    severity: 'critical',
    destination: 'channel',
    trigger:
      'The shared booking-failure reporter fired — a structured dump of where in the booking flow things broke and whether the customer was charged.',
    action:
      'Follow the action line in the message. If it says paid, check bookings + FareHarbor BEFORE refunding or recreating.',
    source: 'lib/booking/notify-booking-failure.ts',
  },
  {
    kind: 'booking.invoice_pdf_failed',
    label: 'Invoice PDF generation failed',
    category: 'operations',
    severity: 'warning',
    destination: 'channel',
    trigger:
      'The confirmation email went out but the VAT invoice PDF could not be generated. The customer is never told.',
    action: 'Issue the invoice manually — a missing VAT invoice on a paid booking is a compliance gap.',
    source: 'lib/booking/send-confirmation-email.ts',
  },
  {
    kind: 'cron.failed',
    label: 'Cron job failed',
    category: 'operations',
    severity: 'warning',
    destination: 'channel',
    trigger:
      'Any scheduled job threw an unhandled error. Crons run unattended, so this is the only way anyone finds out.',
    action: 'Open the Vercel function logs for that cron and read the stack trace.',
    source: 'lib/cron/alert.ts',
  },
  {
    kind: 'fh_consistency.clean',
    label: 'FareHarbor consistency check — all clear',
    category: 'operations',
    severity: 'success',
    destination: 'channel',
    trigger:
      'The daily consistency cron compared every upcoming booking against FareHarbor and found no drift.',
    action: 'None. The daily heartbeat that says the two systems still agree.',
    source: 'api/cron/fh-consistency/route.ts',
  },
  {
    kind: 'fh_consistency.issues',
    label: 'FareHarbor consistency check — issues found',
    category: 'operations',
    severity: 'warning',
    destination: 'channel',
    trigger:
      'An upcoming booking is cancelled or missing in FareHarbor, or its catering note does not match ours.',
    action:
      'Fix each listed booking in FareHarbor (or here) — a note mismatch means the skipper is reading the wrong catering.',
    source: 'api/cron/fh-consistency/route.ts',
  },
  {
    kind: 'fh_consistency.failed',
    label: 'FareHarbor consistency check failed',
    category: 'operations',
    severity: 'warning',
    destination: 'channel',
    trigger: 'The consistency cron could not query Supabase, so nothing was checked.',
    action: 'Check Supabase status and re-run the cron.',
    source: 'api/cron/fh-consistency/route.ts',
  },

  // ── Marketing ─────────────────────────────────────────────────────────────
  {
    kind: 'partner.code_expiring',
    label: 'Partner code expiring soon',
    category: 'marketing',
    severity: 'info',
    destination: 'channel',
    trigger: 'A partner discount code is close to its expiry date.',
    action: 'Generate a fresh code on the partner page and share it with them.',
    source: 'api/cron/partner-code-expiry/route.ts',
  },
  {
    kind: 'promo.code_rotated',
    label: 'Promo code rotated',
    category: 'marketing',
    severity: 'info',
    destination: 'channel',
    trigger: 'A promo code hit its use limit and was automatically deactivated and replaced.',
    action: 'Share the new code with the partners still handing out the old one.',
    source: 'api/admin/booking-flow/book/route.ts',
  },
  {
    kind: 'google_ads.guardrail',
    label: 'Google Ads guardrail',
    category: 'marketing',
    severity: 'warning',
    destination: 'channel',
    trigger:
      'The ads guardrail found campaigns spending without converting. Clear bleeders are auto-paused and reported in the same message.',
    action: 'Review the flagged campaigns in Admin → Google Ads before re-enabling anything.',
    source: 'lib/google-ads/guardrail.ts',
  },
  {
    kind: 'tracking.whatsapp_click',
    label: 'WhatsApp tap from an ad',
    category: 'marketing',
    severity: 'info',
    destination: 'channel',
    trigger:
      'A visitor who arrived from a paid ad tapped the WhatsApp button for the first time in their session.',
    action: 'Answer the WhatsApp message — this is a paid lead mid-conversation.',
    source: 'lib/tracking/whatsapp-alert.ts',
  },
  {
    kind: 'tracking.affiliate_whatsapp_click',
    label: 'WhatsApp tap from an affiliate link',
    category: 'marketing',
    severity: 'info',
    destination: 'dm',
    trigger: 'A visitor from a partner/affiliate link tapped WhatsApp.',
    action:
      "Answer it. Deliberately DM-only — partner conversations don't belong in the shared alerts channel.",
    source: 'lib/tracking/whatsapp-alert.ts',
  },

  // ── System ────────────────────────────────────────────────────────────────
  {
    kind: 'reviews.import_completed',
    label: 'Reviews imported',
    category: 'system',
    severity: 'success',
    destination: 'channel',
    trigger: 'An Outscraper review-scrape job finished and its reviews were imported.',
    action: 'None. New reviews appear on the site automatically.',
    source: 'api/webhooks/outscraper/route.ts',
  },
  {
    kind: 'reviews.job_failed',
    label: 'Review scrape job failed',
    category: 'system',
    severity: 'warning',
    destination: 'channel',
    trigger: 'Outscraper reported the scrape job itself errored — reviews were not updated.',
    action: 'Re-trigger the scrape from Admin → Reviews. Stale reviews are cosmetic, not urgent.',
    source: 'api/webhooks/outscraper/route.ts',
  },
  {
    kind: 'reviews.import_failed',
    label: 'Review import errored',
    category: 'system',
    severity: 'warning',
    destination: 'channel',
    trigger: 'The Outscraper webhook received a payload it could not parse or store.',
    action: 'Check the Vercel logs for the parse error, then re-trigger the scrape.',
    source: 'api/webhooks/outscraper/route.ts',
  },
] as const satisfies readonly SlackNotificationType[]

/** Every valid `kind` — a union type, so a typo is a compile error. */
export type SlackNotificationKind = (typeof SLACK_NOTIFICATION_TYPES)[number]['kind']

export const SLACK_NOTIFICATION_KINDS: readonly string[] = SLACK_NOTIFICATION_TYPES.map(t => t.kind)

/** Look up one type by kind. Returns undefined for a kind logged before it was catalogued. */
export function getSlackNotificationType(kind: string): SlackNotificationType | undefined {
  return SLACK_NOTIFICATION_TYPES.find(t => t.kind === kind)
}

/** Display order for the category filters / grouping in the admin UI. */
export const SLACK_NOTIFICATION_CATEGORIES: readonly SlackNotificationCategory[] = [
  'bookings',
  'payments',
  'catering',
  'operations',
  'marketing',
  'system',
]

export const CATEGORY_LABELS: Record<SlackNotificationCategory, string> = {
  bookings: 'Bookings',
  payments: 'Payments',
  catering: 'Catering',
  operations: 'Operations & recovery',
  marketing: 'Marketing',
  system: 'System',
}

export const SEVERITY_LABELS: Record<SlackNotificationSeverity, string> = {
  success: 'Good news',
  info: 'FYI',
  warning: 'Look soon',
  critical: 'Act now',
}
