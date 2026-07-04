-- 086: guest-move event types on ops_events.
--
-- (Numbering note: 084/085 are taken by main — invoice_numbers and
-- drop_booking_claims — so this branch jumps from 083 to 086 to keep the
-- eventual merge collision-free.)
--
-- The guest-outreach half of the AI Operations Engine (PRD "Smart Guest
-- Suggestions"): the Ghost drafts a move request, a human approves the send,
-- the guest taps a response button. Every step lands here — the accepted /
-- declined outcomes are the future acceptance-probability training data.

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
    'guest_move_expired'
  ));
