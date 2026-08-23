-- 121: fix a silent gap in ops_events_event_type_check + add the one new
-- event type the booking-ops-timeline feature needs.
--
-- 'catering_confirmed' is emitted by gmail/sync.ts (has been since migration
-- 109_catering_confirmation.sql) but is currently MISSING from the live
-- constraint — verified directly against prod via the Management API, the
-- constraint currently rewritten by migration 124 dropped it while adding
-- 'availability_request_sent'/'schedule_digest_sent'. Since emitOpsEvent()
-- swallows all insert errors by design (src/lib/ops/events.ts — "never
-- blocks the caller"), every 'catering_confirmed' event has been silently
-- failing to insert. Nothing broke — bookings.catering_confirmed_at itself
-- is written correctly by a separate statement in the same code path — but
-- the event log has had a silent hole in it.
--
-- This restores 'catering_confirmed' and adds 'catering_order_sent' (new,
-- for the booking-ops-timeline feature) on top of the full current live
-- list, not the older list from migration 086 — full DROP/ADD, since this
-- is a plain CHECK, not a Postgres enum type.

ALTER TABLE public.ops_events DROP CONSTRAINT IF EXISTS ops_events_event_type_check;

ALTER TABLE public.ops_events ADD CONSTRAINT ops_events_event_type_check
  CHECK (event_type IN (
    'booking_created',
    'booking_paid',
    'booking_confirmed',
    'booking_cancelled',
    'booking_fh_failed',
    'booking_fh_recovered',
    'shift_assigned',
    'shift_unassigned',
    'recommendation_created',
    'recommendation_reviewed',
    'recommendation_approved',
    'recommendation_rejected',
    'guest_move_requested',
    'guest_move_accepted',
    'guest_move_declined',
    'guest_move_deferred',
    'guest_move_expired',
    'ads_campaign_paused',
    'extras_upsell_sent',
    'availability_request_sent',
    'schedule_digest_sent',
    'catering_confirmed',
    'catering_order_sent'
  ));
