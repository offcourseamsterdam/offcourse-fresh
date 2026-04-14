-- supabase/migrations/012_extras.sql

-- Extras catalog
CREATE TABLE IF NOT EXISTS extras (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  text NOT NULL,
  name_nl               text, name_de text, name_fr text,
  name_es               text, name_pt text, name_zh text,
  description           text,
  description_nl        text, description_de text, description_fr text,
  description_es        text, description_pt text, description_zh text,
  image_url             text,
  category              text NOT NULL CHECK (category IN ('food','drinks','protection','experience','tax','info')),
  scope                 text NOT NULL CHECK (scope IN ('global','per_listing')),
  applicable_categories text[],
  price_type            text NOT NULL CHECK (price_type IN ('fixed_cents','percentage','per_person_cents','informational')),
  price_value           integer NOT NULL DEFAULT 0,
  vat_rate              integer NOT NULL DEFAULT 9 CHECK (vat_rate IN (0,9,21)),
  is_required           boolean NOT NULL DEFAULT false,
  is_active             boolean NOT NULL DEFAULT true,
  sort_order            integer NOT NULL DEFAULT 0,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

-- Junction table: links per_listing extras to listings; also used to disable global extras per listing
CREATE TABLE IF NOT EXISTS listing_extras (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES cruise_listings(id) ON DELETE CASCADE,
  extra_id   uuid NOT NULL REFERENCES extras(id) ON DELETE CASCADE,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE (listing_id, extra_id)
);

-- Index for reverse lookups: "which listings use this extra?"
CREATE INDEX IF NOT EXISTS listing_extras_extra_id_idx ON listing_extras (extra_id);

-- Extend bookings table with extras data and full VAT breakdown
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS base_amount_cents       integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_vat_rate           integer DEFAULT 9,
  ADD COLUMN IF NOT EXISTS base_vat_amount_cents   integer,
  ADD COLUMN IF NOT EXISTS extras_amount_cents      integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extras_vat_amount_cents  integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_vat_amount_cents   integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extras_selected          jsonb DEFAULT '[]';

-- RLS
ALTER TABLE extras ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_extras ENABLE ROW LEVEL SECURITY;

CREATE POLICY "extras_service_all" ON extras FOR ALL TO service_role USING (true);
CREATE POLICY "listing_extras_service_all" ON listing_extras FOR ALL TO service_role USING (true);
CREATE POLICY "extras_anon_select" ON extras FOR SELECT TO anon USING (is_active = true);
CREATE POLICY "listing_extras_anon_select" ON listing_extras FOR SELECT TO anon USING (true);

-- Auto-update updated_at on extras
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER extras_updated_at
  BEFORE UPDATE ON extras
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed required global extras
INSERT INTO extras (name, category, scope, applicable_categories, price_type, price_value, vat_rate, is_required, sort_order)
VALUES
  ('City Tax', 'tax', 'global', ARRAY['private','shared','standard','special','seasonal','event'], 'per_person_cents', 260, 0, true, 0),
  ('Cancellation Insurance', 'protection', 'global', ARRAY['private','shared'], 'percentage', 15, 21, false, 10),
  ('Cancellation Policy', 'info', 'global', ARRAY['private','shared','standard','special','seasonal','event'], 'informational', 0, 0, false, 20),
  ('Departure Location', 'info', 'global', ARRAY['private','shared','standard','special','seasonal','event'], 'informational', 0, 0, false, 30)
ON CONFLICT DO NOTHING;
