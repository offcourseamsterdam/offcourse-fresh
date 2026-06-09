-- Track when the pre-cruise extras upsell email was sent to the customer
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS extras_upsell_sent_at timestamptz;
