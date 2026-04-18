-- Migration: Partner commission rate + booking attribution
-- Partners get a default commission rate (applied to base price only, never extras)
-- Bookings store which partner sourced the booking + the calculated commission amount

-- 1. Commission rate on the partner (e.g. 15.00 = 15%)
ALTER TABLE partners ADD COLUMN IF NOT EXISTS commission_rate numeric(5,2) NOT NULL DEFAULT 0;

-- 2. Link a booking back to the partner who sourced it
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES partners(id);

-- 3. Pre-calculated commission amount in cents (base_amount_cents × commission_rate / 100)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS commission_amount_cents integer;

-- Index for partner reporting queries (sum commissions by partner)
CREATE INDEX IF NOT EXISTS bookings_partner_id_idx ON bookings(partner_id);
