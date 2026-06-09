-- Snapshot the chosen customer-type label (e.g. "Diana - 2 Hours") on the booking
-- at creation time. FareHarbor's customer_type_rate PK is per-availability, so it
-- can't be reliably mapped back to a name after the fact — storing the resolved
-- name once, at booking time, is the durable fix.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_type_name text;

COMMENT ON COLUMN bookings.customer_type_name IS
  'Human-readable customer type chosen at booking (e.g. "Diana - 2 Hours"). Snapshotted from FareHarbor at checkout; preferred over resolving the volatile customer_type_rate_pk.';
