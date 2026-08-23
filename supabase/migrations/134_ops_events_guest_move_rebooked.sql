-- 134: add 'guest_move_rebooked' — closes the loop when a human confirms they
-- completed the actual FareHarbor rebook after a guest accepted a move ask
-- (Beer, 2026-08-23: "when something was successful to process the
-- rebooking" — previously a guest 'accept' just fired a Slack reminder with
-- nothing recording whether the real rebook ever happened).
--
-- Full DROP/ADD on the plain CHECK constraint, same pattern as migration 121
-- (this is a CHECK, not a Postgres enum type) — based on 121's own full
-- current list, which is what's live in prod today.

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
    'guest_move_rebooked',
    'ads_campaign_paused',
    'extras_upsell_sent',
    'availability_request_sent',
    'schedule_digest_sent',
    'catering_confirmed',
    'catering_order_sent'
  ));
