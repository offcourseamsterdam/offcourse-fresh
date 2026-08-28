-- Phase 4 (2026-08-22): AI-drafted review replies, copy-paste only — no
-- OAuth, no live posting to any platform (see
-- docs/plans/2026-08-22-reviews-bonuses-and-attribution.md Phase 4). The old
-- reply feature (migrations 016/017, dropped in 053) also stored an
-- oauth_refresh_token on this same table behind a public anon-read policy
-- (migration 051's postmortem) — this table has no OAuth columns at all this
-- time, so that failure mode can't repeat.
ALTER TABLE social_proof_reviews
  ADD COLUMN ai_draft_reply text,
  ADD COLUMN replied_at timestamptz;
