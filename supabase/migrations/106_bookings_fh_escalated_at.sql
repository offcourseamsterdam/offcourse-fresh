-- Migration 106: track whether pending-fh-sweep already sent its one-time
-- "PAID BUT UNBOOKED" escalation alert for a booking.
--
-- Why: the sweep cron runs once a day (Vercel Hobby plan), but the escalation
-- alert was written assuming a fixed 15-minute cadence — it fired only inside a
-- narrow 30-45min age window, which a daily run almost never lands inside. That
-- made the alert effectively dead. This column lets the sweep fire the alert
-- exactly once per stuck booking regardless of how often the cron actually runs.
-- Same nullable-timestamp "have we already sent this?" pattern as the existing
-- catering_email_sent_at / extras_upsell_sent_at columns.

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS fh_escalated_at timestamptz;
