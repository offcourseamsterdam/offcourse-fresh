-- Add OAuth token storage for Google Business Profile API (reply to reviews)
-- and reply tracking columns on each review

-- OAuth tokens + Business Profile account info
ALTER TABLE google_reviews_config
  ADD COLUMN IF NOT EXISTS gbp_account_id text,
  ADD COLUMN IF NOT EXISTS gbp_location_id text,
  ADD COLUMN IF NOT EXISTS oauth_access_token text,
  ADD COLUMN IF NOT EXISTS oauth_refresh_token text,
  ADD COLUMN IF NOT EXISTS oauth_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS oauth_connected_at timestamptz,
  ADD COLUMN IF NOT EXISTS oauth_email text;

-- Reply tracking on each review
ALTER TABLE social_proof_reviews
  ADD COLUMN IF NOT EXISTS owner_reply_text text,
  ADD COLUMN IF NOT EXISTS owner_reply_time timestamptz,
  ADD COLUMN IF NOT EXISTS reply_synced_at timestamptz;
