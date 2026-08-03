-- 086_dedupe_shadow_bookings.sql
--
-- One-time data cleanup: remove duplicate "shadow" booking rows.
--
-- Background:
--   Two systems write to public.bookings:
--     1. This Next.js app (Stripe webhook + admin booking wizard) inserts the
--        payment-authoritative row — correct payment_status (paid/comp), Stripe
--        payment-intent id, VAT breakdown, campaign attribution. It NEVER writes
--        raw_payload.
--     2. A separate FareHarbor sync (legacy pre-rebuild pipeline / affiliate
--        channel) inserts rows WITH raw_payload. Most such rows (236 at time of
--        writing) are the sole, legitimate record for their booking, so
--        raw_payload alone is NOT a duplicate marker.
--
--   A duplicate exists only when the SAME FareHarbor booking (same booking_uuid)
--   was recorded by BOTH systems: our authoritative row (raw_payload IS NULL)
--   plus the sync's stale shadow (raw_payload IS NOT NULL, usually status
--   'booked'/'rebooked' + payment_status 'pending'). These shadows double-count
--   in the admin bookings list and any aggregate that includes 'booked' status.
--
-- What this does:
--   Delete the shadow row (raw_payload IS NOT NULL) for every booking_uuid that
--   has two or more rows AND has at least one authoritative row (raw_payload IS
--   NULL) to survive. The survivor — the payment-truth row — is kept.
--
-- Safety:
--   * Every affected booking_uuid keeps exactly one authoritative survivor
--     (verified: 0 pairs without exactly one non-raw survivor).
--   * Solo raw rows (a booking recorded ONLY by the sync) are untouched — their
--     booking_uuid has a single row, so it is not in `dup`.
--   * Inbound FKs (shifts.booking_id, conversations.booking_id) are ON DELETE
--     SET NULL and none reference the shadow ids, so nothing is orphaned.
--   * Idempotent: re-running finds no remaining dup shadows and deletes nothing.
--
-- Recurrence note:
--   This does NOT stop new shadows appearing — that requires changing the
--   external FareHarbor sync (outside this repository) so it updates the existing
--   row instead of inserting a second one. This migration only cleans current state.

WITH dup AS (
  SELECT booking_uuid
  FROM public.bookings
  WHERE booking_uuid IS NOT NULL
  GROUP BY booking_uuid
  HAVING count(*) > 1
),
shadows AS (
  SELECT id
  FROM public.bookings
  WHERE raw_payload IS NOT NULL
    AND booking_uuid IN (SELECT booking_uuid FROM dup)
    -- guard: only delete when an authoritative (non-raw) sibling will survive
    AND booking_uuid IN (
      SELECT booking_uuid FROM public.bookings
      WHERE raw_payload IS NULL AND booking_uuid IS NOT NULL
    )
)
DELETE FROM public.bookings
WHERE id IN (SELECT id FROM shadows);
