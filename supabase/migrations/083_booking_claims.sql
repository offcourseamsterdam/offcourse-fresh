-- booking_claims — a tiny mutex table that makes "one payment → one FareHarbor
-- booking" structurally true.
--
-- Background: iDEAL (and other async Stripe methods) cause two finalize paths to
-- run concurrently for one payment — the browser /book call and the
-- payment_intent.succeeded webhook. Both used to do check-then-act
-- (SELECT bookings by PI → none → create FareHarbor booking → INSERT). The
-- bookings UNIQUE(stripe_payment_intent_id) constraint (migration 052) caught the
-- double INSERT, but only AFTER both had already created a FareHarbor booking.
--
-- This table moves the mutual-exclusion EARLIER: every finalize path must win a
-- claim on the payment-intent id here BEFORE it is allowed to call FareHarbor.
-- The PRIMARY KEY makes the first INSERT win; losers never touch FareHarbor.
-- Rows are short-lived: deleted on success or on FareHarbor failure (rollback);
-- a crashed owner's stale row is reclaimed after a timeout by the next attempt.
--
-- Mirrors the existing claim idioms in google_ads_conversions (report-conversion.ts)
-- and pricing_quotes.consumed_at (create-intent.ts).

CREATE TABLE IF NOT EXISTS booking_claims (
  payment_intent_id text PRIMARY KEY,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE booking_claims ENABLE ROW LEVEL SECURITY;

-- Service-role only — the app touches this table exclusively via the admin client,
-- mirroring the bookings policy from migration 052. No anon access.
CREATE POLICY "service_role_full_access" ON booking_claims
  FOR ALL
  USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text);
