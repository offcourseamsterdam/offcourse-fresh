-- Add is_archived flag to cruise_listings
ALTER TABLE cruise_listings ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;
