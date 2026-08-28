-- Links a social_proof_reviews row back to the Gmail conversation it was
-- ingested from (the GYG "new review" notification email), so the inbox can
-- auto-resolve that conversation once the Reviews tab has dealt with the
-- review — see docs/plans/2026-08-22-reviews-bonuses-and-attribution.md §3.2.
-- Null for every review that arrived via a scraper sync instead of email.
ALTER TABLE social_proof_reviews
  ADD COLUMN conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_social_proof_reviews_conversation_id
  ON social_proof_reviews (conversation_id)
  WHERE conversation_id IS NOT NULL;
