-- Tracks supplier confirmation of a catering order, distinct from
-- catering_email_sent_at (which only records that WE sent the request).
-- catering_thread_id is the Gmail thread the order email lives in, so an
-- inbound reply can be deterministically linked back to this booking without
-- any AI guessing which order a reply is about.
ALTER TABLE bookings ADD COLUMN catering_thread_id text NULL;
ALTER TABLE bookings ADD COLUMN catering_confirmed_at timestamptz NULL;
