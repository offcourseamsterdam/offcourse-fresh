-- ============================================================
-- 021: First-Party Tracking System
-- New tables: channels, tracking_events, notification_settings
-- Extended: campaigns, partners, campaign_links, analytics_sessions
-- ============================================================

-- -------------------------------------------------------
-- 1. NEW TABLE: channels (parent grouping for campaigns)
-- -------------------------------------------------------
CREATE TABLE channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  color text,            -- hex for chart visualization, e.g. '#3b82f6'
  icon text,             -- lucide icon name, e.g. 'instagram'
  display_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "channels_anon_select" ON channels FOR SELECT TO anon USING (true);
CREATE POLICY "channels_service_all" ON channels FOR ALL TO service_role USING (true);

-- Seed default channels
INSERT INTO channels (name, slug, color, icon, display_order) VALUES
  ('Direct',         'direct',       '#71717a', 'globe',      0),
  ('Organic Search', 'organic',      '#22c55e', 'search',     1),
  ('Google Ads',     'google-ads',   '#4285f4', 'target',     2),
  ('Social Media',   'social',       '#e11d48', 'instagram',  3),
  ('Partners',       'partners',     '#f59e0b', 'handshake',  4),
  ('Email',          'email',        '#8b5cf6', 'mail',       5),
  ('Referral',       'referral',     '#06b6d4', 'link',       6);

-- -------------------------------------------------------
-- 2. NEW TABLE: tracking_events (funnel step tracking)
-- -------------------------------------------------------
CREATE TABLE tracking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL REFERENCES analytics_sessions(id) ON DELETE CASCADE,
  visitor_id text NOT NULL,
  event_name text NOT NULL CHECK (event_name IN (
    'page_view',
    'view_homepage',
    'view_cruise_detail',
    'view_booking_panel',
    'select_date',
    'select_time',
    'no_availability',
    'view_checkout',
    'view_payment',
    'view_extras',
    'view_details',
    'booking_completed'
  )),
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tracking_events_session ON tracking_events(session_id);
CREATE INDEX idx_tracking_events_name ON tracking_events(event_name);
CREATE INDEX idx_tracking_events_created ON tracking_events(created_at);

ALTER TABLE tracking_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tracking_events_anon_insert" ON tracking_events FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "tracking_events_service_all" ON tracking_events FOR ALL TO service_role USING (true);

-- -------------------------------------------------------
-- 3. NEW TABLE: notification_settings
-- -------------------------------------------------------
CREATE TABLE notification_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid REFERENCES channels(id) ON DELETE CASCADE,
  partner_id uuid REFERENCES partners(id) ON DELETE CASCADE,
  notify_per_booking boolean NOT NULL DEFAULT false,
  notify_weekly boolean NOT NULL DEFAULT false,
  notify_monthly boolean NOT NULL DEFAULT false,
  notify_quarterly boolean NOT NULL DEFAULT false,
  email_recipients text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_settings_one_target CHECK (
    (channel_id IS NOT NULL AND partner_id IS NULL) OR
    (channel_id IS NULL AND partner_id IS NOT NULL)
  )
);

ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notification_settings_service_all" ON notification_settings FOR ALL TO service_role USING (true);

-- -------------------------------------------------------
-- 4. EXTEND: campaigns — add channel_id, partner_id
-- -------------------------------------------------------
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS channel_id uuid REFERENCES channels(id) ON DELETE SET NULL;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES partners(id) ON DELETE SET NULL;
CREATE INDEX idx_campaigns_channel ON campaigns(channel_id);
CREATE INDEX idx_campaigns_partner ON campaigns(partner_id);

-- -------------------------------------------------------
-- 5. EXTEND: partners — add contact fields
-- -------------------------------------------------------
ALTER TABLE partners ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS contact_name text;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- -------------------------------------------------------
-- 6. EXTEND: campaign_links — add commission_type, fixed_commission_amount, campaign_id
-- -------------------------------------------------------
ALTER TABLE campaign_links ADD COLUMN IF NOT EXISTS commission_type text NOT NULL DEFAULT 'percentage'
  CHECK (commission_type IN ('fixed_amount', 'percentage'));
ALTER TABLE campaign_links ADD COLUMN IF NOT EXISTS fixed_commission_amount integer;
ALTER TABLE campaign_links ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL;
CREATE INDEX idx_campaign_links_campaign ON campaign_links(campaign_id);

-- -------------------------------------------------------
-- 7. EXTEND: analytics_sessions — add channel_id + indexes
-- -------------------------------------------------------
ALTER TABLE analytics_sessions ADD COLUMN IF NOT EXISTS channel_id uuid REFERENCES channels(id) ON DELETE SET NULL;
CREATE INDEX idx_analytics_sessions_channel ON analytics_sessions(channel_id);
CREATE INDEX idx_analytics_sessions_started ON analytics_sessions(started_at);
CREATE INDEX idx_analytics_sessions_visitor ON analytics_sessions(visitor_id);

-- RLS: allow anonymous session creation/update for tracking
CREATE POLICY "analytics_sessions_anon_insert" ON analytics_sessions FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "analytics_sessions_anon_update" ON analytics_sessions FOR UPDATE TO anon USING (true) WITH CHECK (true);
