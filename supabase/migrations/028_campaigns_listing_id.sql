-- Add listing_id to campaigns so each campaign can link to a specific cruise listing
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS listing_id uuid REFERENCES cruise_listings(id);
