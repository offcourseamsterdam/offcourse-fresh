-- Add Google Places API columns to social_proof_reviews
-- These columns track the origin of reviews synced from Google

ALTER TABLE social_proof_reviews
  ADD COLUMN IF NOT EXISTS google_review_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS author_photo_url text,
  ADD COLUMN IF NOT EXISTS google_profile_url text,
  ADD COLUMN IF NOT EXISTS publish_time timestamptz,
  ADD COLUMN IF NOT EXISTS original_text text,
  ADD COLUMN IF NOT EXISTS language text;

-- Index for deduplication on Google sync
CREATE INDEX IF NOT EXISTS idx_social_proof_reviews_google_id
  ON social_proof_reviews (google_review_id)
  WHERE google_review_id IS NOT NULL;

-- Store Google Place ID and sync metadata in a settings-style table
-- so the admin can configure which place to sync from
CREATE TABLE IF NOT EXISTS google_reviews_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  place_id text NOT NULL,
  place_name text,
  overall_rating numeric(2,1),
  total_reviews integer,
  last_synced_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS: anon can read reviews, service role can write
ALTER TABLE google_reviews_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY google_reviews_config_anon_select
  ON google_reviews_config FOR SELECT
  TO anon USING (true);

CREATE POLICY google_reviews_config_service_all
  ON google_reviews_config FOR ALL
  TO service_role USING (true);
