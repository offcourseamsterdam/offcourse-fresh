-- 123: ops_events needs to capture the non-AI automated actions too — the
-- Google Ads spend guardrail's auto-pause and the extras-upsell cron both
-- execute for real with zero AI reasoning involved, but today only post to
-- Slack. Nothing queryable survives, so a future "what did automated code do
-- on its own" admin panel would have nothing to show.
ALTER TABLE public.ops_events DROP CONSTRAINT IF EXISTS ops_events_event_type_check;

ALTER TABLE public.ops_events ADD CONSTRAINT ops_events_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'booking_created', 'booking_paid', 'booking_confirmed', 'booking_cancelled',
    'booking_fh_failed', 'booking_fh_recovered', 'shift_assigned', 'shift_unassigned',
    'recommendation_created', 'recommendation_reviewed', 'recommendation_approved', 'recommendation_rejected',
    'guest_move_requested', 'guest_move_accepted', 'guest_move_declined', 'guest_move_deferred', 'guest_move_expired',
    'ads_campaign_paused', 'extras_upsell_sent'
  ]));
