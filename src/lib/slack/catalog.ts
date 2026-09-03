export type NotificationDirection = 'outbound' | 'inbound'
export type NotificationCategory =
  | 'booking'
  | 'payment'
  | 'catering'
  | 'operations'
  | 'alerts'
  | 'marketing'
  | 'ai'
  | 'integrations'
  | 'inbound'
export type RecipientType = 'webhook' | 'channel' | 'dm' | 'command'
export type Severity = 'info' | 'warning' | 'critical'

export type NotificationEntry = {
  id: string
  label: string
  description: string
  trigger: string
  direction: NotificationDirection
  category: NotificationCategory
  recipientType: RecipientType
  channel: string
  severity: Severity
}

export const NOTIFICATION_CATALOG: NotificationEntry[] = [
  // ── BOOKING ────────────────────────────────────────────────────────────
  {
    id: 'booking-admin-confirmed',
    label: 'Booking confirmed',
    description: 'New booking created via the admin booking form or a partner-invoice flow. Includes listing, date, guests, amount, and customer details.',
    trigger: 'POST /api/admin/booking-flow/book — FH + Supabase both succeed',
    direction: 'outbound',
    category: 'booking',
    recipientType: 'webhook',
    channel: '#bookings (SLACK_WEBHOOK_URL)',
    severity: 'info',
  },
  {
    id: 'booking-save-failed',
    label: 'Booking save failed — CRITICAL',
    description: 'FareHarbor booking created and Stripe charged, but the Supabase insert failed. Customer has paid; booking exists in FH but not in our DB. Manual recovery required.',
    trigger: 'Supabase insert error after FH booking succeeds',
    direction: 'outbound',
    category: 'booking',
    recipientType: 'webhook',
    channel: '#bookings (SLACK_WEBHOOK_URL)',
    severity: 'critical',
  },
  {
    id: 'booking-failure',
    label: 'Booking failed',
    description: 'FareHarbor validation failed, FH createBooking threw, or the Supabase save failed. Covers all failure stages in the booking pipeline.',
    trigger: 'Any exception in booking-flow/book or the Stripe webhook booking path',
    direction: 'outbound',
    category: 'booking',
    recipientType: 'webhook',
    channel: '#bookings (SLACK_WEBHOOK_URL)',
    severity: 'warning',
  },
  {
    id: 'webhook-booking-failed',
    label: 'Webhook booking failed — CRITICAL',
    description: 'Customer paid via the Stripe webhook (iDEAL / payment link) but FH or DB creation failed. Money taken, no booking created.',
    trigger: 'payment_intent.succeeded Stripe event — FH or DB error',
    direction: 'outbound',
    category: 'booking',
    recipientType: 'webhook',
    channel: '#bookings (SLACK_WEBHOOK_URL)',
    severity: 'critical',
  },

  // ── PAYMENT ────────────────────────────────────────────────────────────
  {
    id: 'payment-link-confirmed',
    label: 'Payment link — booking confirmed',
    description: 'Customer completed payment on a Stripe Checkout Session (the payment link flow used for external bookings).',
    trigger: 'checkout.session.completed Stripe event',
    direction: 'outbound',
    category: 'payment',
    recipientType: 'webhook',
    channel: '#bookings (SLACK_WEBHOOK_URL)',
    severity: 'info',
  },
  {
    id: 'payment-link-db-failed',
    label: 'Payment link — DB update failed — CRITICAL',
    description: 'Customer paid on a payment link but the Supabase booking status update failed. Manual status flip required.',
    trigger: 'checkout.session.completed — Supabase update error',
    direction: 'outbound',
    category: 'payment',
    recipientType: 'webhook',
    channel: '#bookings (SLACK_WEBHOOK_URL)',
    severity: 'critical',
  },
  {
    id: 'payment-link-expired',
    label: 'Payment link expired',
    description: 'A Stripe Checkout Session expired after 24h without payment. The FH booking has been cancelled.',
    trigger: 'checkout.session.expired Stripe event',
    direction: 'outbound',
    category: 'payment',
    recipientType: 'webhook',
    channel: '#bookings (SLACK_WEBHOOK_URL)',
    severity: 'info',
  },
  {
    id: 'async-payment-confirmed',
    label: 'Async payment confirmed (iDEAL/SEPA)',
    description: 'An iDEAL, Bancontact, or SEPA payment succeeded asynchronously. The booking and FH reservation are created at this point.',
    trigger: 'payment_intent.succeeded Stripe event (async payment method)',
    direction: 'outbound',
    category: 'payment',
    recipientType: 'webhook',
    channel: '#bookings (SLACK_WEBHOOK_URL)',
    severity: 'info',
  },
  {
    id: 'refund-issued',
    label: 'Refund issued',
    description: 'A full or partial refund was processed via the Stripe dashboard.',
    trigger: 'charge.refunded Stripe event',
    direction: 'outbound',
    category: 'payment',
    recipientType: 'webhook',
    channel: '#bookings (SLACK_WEBHOOK_URL)',
    severity: 'info',
  },
  {
    id: 'chargeback-opened',
    label: 'Chargeback opened — CRITICAL',
    description: 'A customer opened a payment dispute. Must respond within 7 days via the Stripe dashboard.',
    trigger: 'charge.dispute.created Stripe event',
    direction: 'outbound',
    category: 'payment',
    recipientType: 'webhook',
    channel: '#bookings (SLACK_WEBHOOK_URL)',
    severity: 'critical',
  },
  {
    id: 'payment-failed',
    label: 'Payment declined',
    description: 'A card, iDEAL, or other payment method was declined.',
    trigger: 'payment_intent.payment_failed Stripe event',
    direction: 'outbound',
    category: 'payment',
    recipientType: 'webhook',
    channel: '#bookings (SLACK_WEBHOOK_URL)',
    severity: 'warning',
  },

  // ── CATERING ────────────────────────────────────────────────────────────
  {
    id: 'catering-order',
    label: 'New catering order',
    description: 'A booking includes food or drink extras. Marked URGENT when the cruise is < 24h away.',
    trigger: 'Booking created with food/drink extras',
    direction: 'outbound',
    category: 'catering',
    recipientType: 'webhook',
    channel: '#bookings (SLACK_WEBHOOK_URL)',
    severity: 'info',
  },
  {
    id: 'catering-email-sent',
    label: 'Catering email sent to supplier',
    description: 'Admin clicked "Send to supplier" in the catering panel. Can be resent if needed.',
    trigger: 'Admin action: POST /api/admin/bookings/{id}/catering-email',
    direction: 'outbound',
    category: 'catering',
    recipientType: 'webhook',
    channel: '#bookings (SLACK_WEBHOOK_URL)',
    severity: 'info',
  },
  {
    id: 'catering-extras-upsell',
    label: 'Catering added via upsell',
    description: 'A customer added food or drink extras on the post-booking upsell page.',
    trigger: 'POST /api/booking/extras/{id} — customer adds catering items',
    direction: 'outbound',
    category: 'catering',
    recipientType: 'webhook',
    channel: '#bookings (SLACK_WEBHOOK_URL)',
    severity: 'info',
  },

  // ── OPERATIONS ─────────────────────────────────────────────────────────
  {
    id: 'shift-reminder',
    label: 'Shift reminder',
    description: "Sent 5–10 minutes before a shift starts. Goes directly to the captain's Slack DM if their member ID is linked; falls back to the ops channel otherwise.",
    trigger: 'Cron every 5 min (/api/cron/shift-reminder) — finds shifts starting soon',
    direction: 'outbound',
    category: 'operations',
    recipientType: 'dm',
    channel: "Captain's DM (SLACK_BOT_TOKEN) or SLACK_OPS_CHANNEL fallback",
    severity: 'info',
  },
  {
    id: 'shift-assigned',
    label: 'Shift assigned',
    description: "Admin assigns a shift to a staff member in the scheduling UI. Pings the captain's DM and sends an audit copy to Beer's DM.",
    trigger: 'Admin assigns shift in /admin/scheduling',
    direction: 'outbound',
    category: 'operations',
    recipientType: 'dm',
    channel: "Captain DM + Beer's DM (SLACK_ALERT_DM_CHANNEL)",
    severity: 'info',
  },
  {
    id: 'maintenance-email-sent',
    label: 'Maintenance email sent',
    description: 'Admin approved a Ghost-drafted maintenance email and it was dispatched to the technician.',
    trigger: "Admin clicks Approve & send on a maintenance_task proposal",
    direction: 'outbound',
    category: 'operations',
    recipientType: 'webhook',
    channel: '#bookings (SLACK_WEBHOOK_URL)',
    severity: 'info',
  },
  {
    id: 'stock-reorder-sent',
    label: 'Stock reorder email sent',
    description: 'Admin approved a Ghost-drafted stock reorder email and it was dispatched to the supplier.',
    trigger: 'Admin clicks Approve & send on a stock_reorder proposal',
    direction: 'outbound',
    category: 'operations',
    recipientType: 'webhook',
    channel: '#bookings (SLACK_WEBHOOK_URL)',
    severity: 'info',
  },

  // ── ALERTS ─────────────────────────────────────────────────────────────
  {
    id: 'cron-failed',
    label: 'Cron job failed',
    description: 'Any scheduled cron route caught an unexpected error. Check Vercel logs for the stack trace.',
    trigger: 'Error in any /api/cron/** route',
    direction: 'outbound',
    category: 'alerts',
    recipientType: 'webhook',
    channel: '#bookings (SLACK_WEBHOOK_URL)',
    severity: 'warning',
  },
  {
    id: 'fh-consistency-check',
    label: 'FareHarbor consistency check',
    description: 'Daily check comparing Supabase bookings against FareHarbor. Posts all-clear or a list of mismatches to investigate.',
    trigger: 'Cron daily 08:00 Amsterdam (/api/cron/fh-consistency)',
    direction: 'outbound',
    category: 'alerts',
    recipientType: 'webhook',
    channel: '#bookings (SLACK_WEBHOOK_URL)',
    severity: 'info',
  },

  // ── MARKETING ──────────────────────────────────────────────────────────
  {
    id: 'promo-code-rotated',
    label: 'Promo code rotated',
    description: "A partner's promo code hit its max-uses limit and was automatically replaced with a new one.",
    trigger: 'Booking uses a partner code at its max_uses limit',
    direction: 'outbound',
    category: 'marketing',
    recipientType: 'webhook',
    channel: '#bookings (SLACK_WEBHOOK_URL)',
    severity: 'info',
  },
  {
    id: 'partner-code-expiring',
    label: 'Partner code expiring soon',
    description: 'A partner promo code expires within 14 days. Sent every Monday.',
    trigger: 'Cron every Monday 09:00 (/api/cron/partner-code-expiry)',
    direction: 'outbound',
    category: 'marketing',
    recipientType: 'webhook',
    channel: '#bookings (SLACK_WEBHOOK_URL)',
    severity: 'warning',
  },
  {
    id: 'google-ads-guardrail',
    label: 'Google Ads guardrail',
    description: 'A campaign is overspending, burning without conversions, or losing money. May auto-pause campaigns if configured.',
    trigger: 'Daily guardrail cron or manual check (src/lib/google-ads/guardrail.ts)',
    direction: 'outbound',
    category: 'marketing',
    recipientType: 'webhook',
    channel: '#bookings (SLACK_WEBHOOK_URL)',
    severity: 'warning',
  },
  {
    id: 'whatsapp-click',
    label: 'Google Ads WhatsApp click',
    description: 'A Google Ads visitor tapped a WhatsApp button. Deduped to the first tap per session.',
    trigger: 'POST /api/tracking/whatsapp — gclid present in session',
    direction: 'outbound',
    category: 'marketing',
    recipientType: 'webhook',
    channel: '#bookings (SLACK_WEBHOOK_URL)',
    severity: 'info',
  },

  // ── AI ─────────────────────────────────────────────────────────────────
  {
    id: 'ai-spend-alert',
    label: 'AI spend threshold alert',
    description: 'Every €5 of cumulative Claude/Gemini spend triggers a DM. Uses ai_usage_alerts for exactly-once delivery.',
    trigger: 'recordAiUsage() crosses the next €5 threshold',
    direction: 'outbound',
    category: 'ai',
    recipientType: 'dm',
    channel: "Beer's Slack DM (AI_COST_ALERT_SLACK_ID)",
    severity: 'info',
  },

  // ── INTEGRATIONS ───────────────────────────────────────────────────────
  {
    id: 'outscraper-reviews-imported',
    label: 'Reviews imported (Outscraper)',
    description: 'An Outscraper scraping job completed and imported new reviews from Google or TripAdvisor.',
    trigger: 'POST /api/webhooks/outscraper — status ok',
    direction: 'outbound',
    category: 'integrations',
    recipientType: 'webhook',
    channel: '#bookings (SLACK_WEBHOOK_URL)',
    severity: 'info',
  },
  {
    id: 'outscraper-error',
    label: 'Outscraper error',
    description: 'An Outscraper scraping job returned an error or failure status.',
    trigger: 'POST /api/webhooks/outscraper — status error/failure',
    direction: 'outbound',
    category: 'integrations',
    recipientType: 'webhook',
    channel: '#bookings (SLACK_WEBHOOK_URL)',
    severity: 'warning',
  },

  // ── INBOUND ────────────────────────────────────────────────────────────
  {
    id: 'slack-checkin-checkout',
    label: 'Captain check-in / check-out',
    description: 'Captains use /checkin and /checkout slash commands to clock their shifts. Creates or updates time_entries in Supabase. Response is ephemeral (only visible to the captain).',
    trigger: 'Captain types /checkin or /checkout in any Slack channel',
    direction: 'inbound',
    category: 'inbound',
    recipientType: 'command',
    channel: 'Any channel (SLACK_SIGNING_SECRET required)',
    severity: 'info',
  },
  {
    id: 'slack-maintenance-intake',
    label: 'Maintenance channel intake',
    description: 'Messages (text and/or photos) posted in the maintenance channel are read by the Ghost AI agent, which drafts a technician email as a shadow proposal.',
    trigger: 'Human posts in SLACK_MAINTENANCE_CHANNEL_ID',
    direction: 'inbound',
    category: 'inbound',
    recipientType: 'channel',
    channel: 'SLACK_MAINTENANCE_CHANNEL_ID (env var)',
    severity: 'info',
  },
]

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  booking: 'Booking',
  payment: 'Payment',
  catering: 'Catering',
  operations: 'Operations',
  alerts: 'Alerts',
  marketing: 'Marketing',
  ai: 'AI',
  integrations: 'Integrations',
  inbound: 'Inbound',
}

export const CATEGORY_COLORS: Record<NotificationCategory, string> = {
  booking: 'bg-blue-50 text-blue-700',
  payment: 'bg-violet-50 text-violet-700',
  catering: 'bg-amber-50 text-amber-700',
  operations: 'bg-teal-50 text-teal-700',
  alerts: 'bg-red-50 text-red-700',
  marketing: 'bg-green-50 text-green-700',
  ai: 'bg-indigo-50 text-indigo-700',
  integrations: 'bg-zinc-100 text-zinc-600',
  inbound: 'bg-sky-50 text-sky-700',
}
