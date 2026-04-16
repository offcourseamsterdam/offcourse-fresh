-- ============================================================
-- 022: Add channel_id to partners table
-- Partners always belong to a channel (e.g. Social Media → Influencer)
-- ============================================================

ALTER TABLE partners ADD COLUMN IF NOT EXISTS channel_id uuid REFERENCES channels(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_partners_channel ON partners(channel_id);
