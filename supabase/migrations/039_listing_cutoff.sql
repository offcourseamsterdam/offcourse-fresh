-- Per-listing booking cutoff override.
-- When set, this value takes precedence over the FareHarbor item's booking_cutoff_hours.
ALTER TABLE cruise_listings
  ADD COLUMN IF NOT EXISTS booking_cutoff_hours integer DEFAULT NULL;

COMMENT ON COLUMN cruise_listings.booking_cutoff_hours IS
  'Override the FH item-level cutoff for this listing only. NULL = use the FH item default.';
