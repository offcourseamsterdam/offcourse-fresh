-- SECURITY FIX: bookings table — two issues in one migration.
--
-- Issue A: The only RLS policy is "admin_all" with USING (true) for {public} roles.
-- "public" in PostgreSQL means every role, including the browser-facing "anon" role.
-- So anyone holding the public anon key (which ships in the browser bundle) can
-- SELECT every booking row: customer names, emails, phones, and Stripe PI IDs.
-- The app reads bookings exclusively via the service-role admin client, so the
-- anon policy provides zero legitimate value and must be replaced.
--
-- Issue B: bookings.stripe_payment_intent_id has a plain btree INDEX but NOT a
-- unique constraint. The webhook and browser /book both run the pattern:
--   1. "does a booking exist for this PI?" → no
--   2. create FareHarbor booking → insert booking row
-- In theory both can pass step 1 before either reaches step 2, resulting in two
-- FareHarbor bookings for one payment. The unique constraint makes the second
-- INSERT fail fast (losing the race rather than double-booking). NULLs are fine —
-- PostgreSQL treats each NULL as distinct, so historical rows without a PI ID are
-- unaffected. Confirmed: 0 existing duplicates before applying this migration.

-- ── Fix A: replace the permissive anon policy ──────────────────────────────

DROP POLICY IF EXISTS admin_all ON bookings;

CREATE POLICY "service_role_full_access" ON bookings
  FOR ALL
  USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

-- ── Fix B: unique constraint on stripe_payment_intent_id ───────────────────

ALTER TABLE bookings
  ADD CONSTRAINT bookings_stripe_payment_intent_id_unique
  UNIQUE (stripe_payment_intent_id);
