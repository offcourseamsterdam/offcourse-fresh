-- Add optional video_url and google_maps_url columns to cruise_listings
-- video_url: when present, an MP4 video fills the middle column of the image gallery
-- google_maps_url: Google Maps embed URL for the departure point map on the cruise page
ALTER TABLE cruise_listings ADD COLUMN IF NOT EXISTS video_url text;
ALTER TABLE cruise_listings ADD COLUMN IF NOT EXISTS google_maps_url text;
