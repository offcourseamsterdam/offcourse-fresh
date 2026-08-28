-- Distinguishes "AI checked this review for staff mentions and found
-- nothing" from "never checked at all" — without this, the ~150 reviews
-- imported before awardReviewBonuses existed all read as "no match" in the
-- Reviews tab overview, when the honest answer is "not yet scanned"
-- (Beer, 2026-08-22: "pre assign them with the help of AI").
ALTER TABLE social_proof_reviews
  ADD COLUMN bonus_checked_at timestamptz;
