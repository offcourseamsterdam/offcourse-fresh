-- Migration 053: Replace Google OAuth/Places reviews with Outscraper (Google + TripAdvisor)
--
-- Column names confirmed from live DB (actual names differ from plan estimates):
--   access_token / refresh_token / token_expires_at  (not oauth_access_token etc.)
--
-- What this does:
--   google_reviews_config  — remove OAuth token + GBP account columns; add TripAdvisor
--                            fields + webhook deduplication
--   social_proof_reviews   — add review_image_url; remove reply columns; clean re-import
--                            of Google rows; rename google_review_id → external_review_id;
--                            replace single-column unique with composite unique

-- ── google_reviews_config ──────────────────────────────────────────────────────────────

ALTER TABLE google_reviews_config
  DROP COLUMN IF EXISTS access_token,
  DROP COLUMN IF EXISTS refresh_token,
  DROP COLUMN IF EXISTS token_expires_at,
  DROP COLUMN IF EXISTS google_account_id,
  DROP COLUMN IF EXISTS google_location_id;

ALTER TABLE google_reviews_config
  ADD COLUMN IF NOT EXISTS tripadvisor_url           text,
  ADD COLUMN IF NOT EXISTS tripadvisor_rating        numeric(2,1),
  ADD COLUMN IF NOT EXISTS tripadvisor_total_reviews integer,
  -- Stores Outscraper request IDs to prevent duplicate webhook processing
  ADD COLUMN IF NOT EXISTS outscraper_processed_ids  text[] DEFAULT '{}';

-- ── social_proof_reviews ───────────────────────────────────────────────────────────────

-- Photo attached to the review by the reviewer (from Outscraper review_img_urls[0])
ALTER TABLE social_proof_reviews
  ADD COLUMN IF NOT EXISTS review_image_url text;

-- Remove reply columns (reply feature dropped; Outscraper is read-only)
ALTER TABLE social_proof_reviews
  DROP COLUMN IF EXISTS owner_reply_text,
  DROP COLUMN IF EXISTS owner_reply_time,
  DROP COLUMN IF EXISTS reply_synced_at,
  DROP COLUMN IF EXISTS ai_draft_reply,
  DROP COLUMN IF EXISTS confirmed_reply,
  DROP COLUMN IF EXISTS reply_posted_at,
  DROP COLUMN IF EXISTS reply_posted_by;

-- Clean re-import: delete old OAuth/Places-synced Google rows.
-- Outscraper will repopulate them fresh with its own consistent IDs on first sync.
-- Preserves source='manual' hand-added social-proof rows.
DELETE FROM social_proof_reviews WHERE source = 'google';

-- Drop the old single-column unique on google_review_id (about to be renamed)
ALTER TABLE social_proof_reviews
  DROP CONSTRAINT IF EXISTS social_proof_reviews_google_review_id_key;

-- Rename google_review_id → external_review_id (now covers both Google + TripAdvisor)
ALTER TABLE social_proof_reviews
  RENAME COLUMN google_review_id TO external_review_id;

-- Add composite unique: (source, external_review_id).
-- NULLs are distinct in PostgreSQL so manual rows (external_review_id IS NULL) are unaffected.
ALTER TABLE social_proof_reviews
  ADD CONSTRAINT social_proof_reviews_source_external_id_unique
  UNIQUE (source, external_review_id);
