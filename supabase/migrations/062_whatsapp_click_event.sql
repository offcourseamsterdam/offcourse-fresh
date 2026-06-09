-- ============================================================
-- 056: Add 'whatsapp_click' tracking event
-- Lets the funnel/event system record when a visitor taps any
-- WhatsApp button (floating bubble, footer link, or the
-- "chat to book" timeslot button). Counted once per session per
-- source via client-side dedup; aggregated server-side as unique
-- sessions.
-- ============================================================

-- Rebuild the event_name CHECK constraint to include the new value.
-- (CHECK constraints can't be altered in place — drop + recreate.)
ALTER TABLE tracking_events DROP CONSTRAINT IF EXISTS tracking_events_event_name_check;

ALTER TABLE tracking_events ADD CONSTRAINT tracking_events_event_name_check
  CHECK (event_name IN (
    'page_view',
    'view_homepage',
    'view_cruise_detail',
    'view_booking_panel',
    'select_date',
    'select_time',
    'view_boat',
    'view_tickets',
    'no_availability',
    'view_checkout',
    'view_payment',
    'view_extras',
    'view_details',
    'booking_completed',
    'whatsapp_click'
  ));
