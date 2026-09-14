-- ============================================================
-- 115: Session Reached Checkout Tracking
-- Adds reached_checkout boolean flag to analytics_sessions
-- so the entry funnel accurately tracks checkout visits
-- without dropping successful bookings or anonymous visitors.
-- ============================================================

ALTER TABLE analytics_sessions
ADD COLUMN IF NOT EXISTS reached_checkout boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_reached_checkout
ON analytics_sessions(reached_checkout)
WHERE reached_checkout = true;

-- Backfill historical sessions that reached checkout:
-- 1. Entry or exit page has checkout
-- 2. Entry or exit page has confirmation
-- 3. Session generated a booking
-- 4. Session logged checkout/payment funnel events
UPDATE analytics_sessions
SET reached_checkout = true
WHERE reached_checkout = false
  AND (
    entry_page ILIKE '%checkout%'
    OR exit_page ILIKE '%checkout%'
    OR entry_page ILIKE '%confirmation%'
    OR exit_page ILIKE '%confirmation%'
    OR id IN (SELECT session_id FROM bookings WHERE session_id IS NOT NULL)
    OR id IN (
      SELECT session_id
      FROM tracking_events
      WHERE event_name IN ('view_details', 'view_payment', 'view_checkout', 'booking_completed')
    )
  );
