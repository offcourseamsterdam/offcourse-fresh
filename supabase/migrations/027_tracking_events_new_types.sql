-- Add view_boat and view_tickets to the tracking_events CHECK constraint
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
    'booking_completed'
  ));
