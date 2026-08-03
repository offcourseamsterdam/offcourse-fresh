-- 085_drop_booking_claims.sql
--
-- The booking money path now has a SINGLE finalizer (the Stripe webhook), which
-- writes the bookings row at status 'paid_pending_fh' the instant payment succeeds.
-- The existing UNIQUE(stripe_payment_intent_id) constraint (migration 052) is the
-- exactly-once gate: a duplicate Stripe delivery loses the INSERT (23505) and exits
-- before any FareHarbor call. The per-payment claim mutex (migration 083) is no
-- longer needed and is dropped here.
--
-- Note on the new 'paid_pending_fh' (and transient 'fh_in_progress') booking states:
-- bookings.status is a free-text column with NO check constraint or enum, so adding
-- these values needs NO DDL — they are written by the webhook + the pending-fh-sweep
-- cron and read by the admin list / confirmation gate. Nothing here defines them.

DROP TABLE IF EXISTS booking_claims;
