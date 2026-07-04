-- Add Withlocals experience short-ID config and cross-source duplicate tracking.

-- Store the short ID from the Withlocals experience URL slug (last 8-char hex segment).
ALTER TABLE google_reviews_config
ADD COLUMN IF NOT EXISTS withlocals_experience_short_id TEXT;

-- When a newly-imported Withlocals review looks like a copy of an existing review
-- from another platform (Google, TripAdvisor), store a reference to the suspected
-- original so the admin can decide without having to search manually.
ALTER TABLE social_proof_reviews
ADD COLUMN IF NOT EXISTS possible_duplicate_of UUID REFERENCES social_proof_reviews(id) ON DELETE SET NULL;
