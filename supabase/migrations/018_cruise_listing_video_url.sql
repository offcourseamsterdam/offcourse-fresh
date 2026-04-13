-- Add optional video_url column to cruise_listings
-- Used in the image gallery: when present, an MP4 video fills the middle column
ALTER TABLE cruise_listings ADD COLUMN IF NOT EXISTS video_url text;
