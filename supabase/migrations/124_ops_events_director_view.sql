-- 124: two new ops_events types for the director's-view crons —
-- availability_request_sent (monthly captain availability request) and
-- schedule_digest_sent (daily 18:00 captain schedule digest). Both are
-- automated, zero-AI-judgment actions, same category as ads_campaign_paused
-- and extras_upsell_sent added in migration 123.
ALTER TABLE public.ops_events DROP CONSTRAINT IF EXISTS ops_events_event_type_check;

ALTER TABLE public.ops_events ADD CONSTRAINT ops_events_event_type_check
  CHECK (event_type IN (
    'booking_created', 'booking_paid', 'booking_confirmed', 'booking_cancelled',
    'booking_fh_failed', 'booking_fh_recovered', 'shift_assigned', 'shift_unassigned',
    'recommendation_created', 'recommendation_reviewed', 'recommendation_approved', 'recommendation_rejected',
    'guest_move_requested', 'guest_move_accepted', 'guest_move_declined', 'guest_move_deferred', 'guest_move_expired',
    'ads_campaign_paused', 'extras_upsell_sent',
    'availability_request_sent', 'schedule_digest_sent'
  ));
