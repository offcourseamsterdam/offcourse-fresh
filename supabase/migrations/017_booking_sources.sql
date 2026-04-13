-- Add booking_source and deposit_amount_cents to bookings table
-- booking_source: tracks where the booking came from (website, complimentary, withlocals, clickandboat, etc.)
-- deposit_amount_cents: what the platform deposits after fees (null for website bookings, 0 for comp, >0 for platforms)

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_source text NOT NULL DEFAULT 'website';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deposit_amount_cents integer;
