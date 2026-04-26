-- ============================================================
-- 035: Add campaign_id FK to analytics_sessions
--
-- analytics_sessions previously only stored campaign_slug (text).
-- This adds a proper FK so sessions can be joined to campaigns
-- by UUID, enabling accurate attribution queries.
-- ============================================================

ALTER TABLE analytics_sessions
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_campaign ON analytics_sessions(campaign_id);
