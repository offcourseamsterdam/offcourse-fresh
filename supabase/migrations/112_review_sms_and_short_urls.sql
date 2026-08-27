-- Migration 112: Review SMS + first-party URL shortener
--
-- google_reviews_config:
--   recommendations_map_url  — destination for /r/map short link (Google Maps list)
--   tripadvisor_review_url   — DIRECT review submission page (distinct from tripadvisor_url
--                              which is the listing profile; this is the "write a review" link)
--   review_sms_template      — customisable SMS template; NULL = use hardcoded brand default
--   review_sms_enabled       — master kill-switch for the SMS feature (defaults ON)
--   review_sms_auto_send     — when true, cron sends automatically; false = Slack DM proposal
--
-- bookings:
--   review_sms_sent_at       — idempotency timestamp; prevents double-sends
--   review_sms_phone         — the number we sent to (normalised E.164)
--   review_sms_sid           — Twilio MessageSid returned on success
--
-- short_url_clicks:
--   lightweight click log for /r/* branded redirects

-- ── google_reviews_config ───────────────────────────────────────────────────

ALTER TABLE google_reviews_config
  ADD COLUMN IF NOT EXISTS recommendations_map_url text,
  ADD COLUMN IF NOT EXISTS tripadvisor_review_url   text,
  ADD COLUMN IF NOT EXISTS review_sms_template      text,
  ADD COLUMN IF NOT EXISTS review_sms_enabled       boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS review_sms_auto_send     boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN google_reviews_config.recommendations_map_url IS
  'Destination URL for the /r/map branded short link (e.g. a Google Maps curated list).';
COMMENT ON COLUMN google_reviews_config.tripadvisor_review_url IS
  'Direct TripAdvisor "write a review" link. Separate from tripadvisor_url (the listing profile).';
COMMENT ON COLUMN google_reviews_config.review_sms_template IS
  'Customisable SMS template. Supports {firstName}, {listingTitle}, {mapUrl}, {reviewUrl} tokens.
  NULL means use the hardcoded brand-default English template.';
COMMENT ON COLUMN google_reviews_config.review_sms_enabled IS
  'Master toggle for the post-cruise review SMS feature.';
COMMENT ON COLUMN google_reviews_config.review_sms_auto_send IS
  'When true the cron job sends SMS automatically. When false (default) it sends a Slack DM
  proposal to Beer instead and waits for manual approval in /admin/bookings.';

-- ── bookings ────────────────────────────────────────────────────────────────

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS review_sms_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_sms_phone   text,
  ADD COLUMN IF NOT EXISTS review_sms_sid     text;

COMMENT ON COLUMN bookings.review_sms_sent_at IS
  'Timestamp when the post-cruise review SMS was dispatched. NULL = not yet sent.
  Used as idempotency guard — set immediately on dispatch to prevent double-sends.';
COMMENT ON COLUMN bookings.review_sms_phone IS
  'E.164 phone number the review SMS was sent to.';
COMMENT ON COLUMN bookings.review_sms_sid IS
  'Twilio MessageSid returned on successful send.';

-- ── short_url_clicks ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS short_url_clicks (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text        NOT NULL,       -- 'map' | 'review'
  booking_id      text,                       -- optional; set for /r/m/[id] and /r/t/[id] variants
  destination_url text        NOT NULL,
  user_agent      text,
  ip_hash         text,                       -- SHA-256 of IP — never the raw IP
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Index for analytics queries (e.g. clicks per slug per day)
CREATE INDEX IF NOT EXISTS short_url_clicks_slug_created_at_idx
  ON short_url_clicks (slug, created_at DESC);

ALTER TABLE short_url_clicks ENABLE ROW LEVEL SECURITY;

-- Only the service role can read/write (admin client uses service role key)
CREATE POLICY "service role full access" ON short_url_clicks
  FOR ALL
  USING (false)
  WITH CHECK (false);
