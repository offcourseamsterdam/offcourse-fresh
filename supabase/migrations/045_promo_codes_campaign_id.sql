-- 045_promo_codes_campaign_id.sql
-- Scope a promo code to a specific campaign.
--
-- When a code has campaign_id set:
--   1. It only validates on the campaign's destination listing (codes can't be
--      used on other cruises by mistake or by sharing).
--   2. The booking is automatically attributed to that campaign's partner so
--      commission accrues — feeds the quarterly partner-settlement view.
--
-- When campaign_id is NULL the code stays globally valid (legacy behaviour).

ALTER TABLE promo_codes
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL;

COMMENT ON COLUMN promo_codes.campaign_id IS
  'When set, the promo code is locked to this campaign''s destination listing AND any booking that uses the code is auto-attributed to the campaign''s partner (commission flows). NULL = global code.';

CREATE INDEX IF NOT EXISTS promo_codes_campaign_id_idx ON promo_codes(campaign_id) WHERE campaign_id IS NOT NULL;
