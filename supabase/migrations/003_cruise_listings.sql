-- Cruise listings — the virtual product layer.
-- Each listing is a named cruise experience that maps to one FareHarbor item
-- via fareharbor_item_pk (stored directly as a bigint, no FK join needed).
-- The 3-layer filter system (resource PKs, customer type PKs, time rules)
-- is applied in src/lib/fareharbor/filters.ts at query time.

CREATE TABLE IF NOT EXISTS public.cruise_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- FareHarbor item this listing pulls availability from.
  -- Stored as a direct bigint PK, consistent with allowed_resource_pks
  -- and allowed_customer_type_pks below.
  fareharbor_item_pk bigint NOT NULL,

  slug text UNIQUE NOT NULL,

  -- Content (English base + 6 AI-translated languages)
  title text NOT NULL,
  title_nl text, title_de text, title_fr text, title_es text, title_pt text, title_zh text,
  tagline text,
  tagline_nl text, tagline_de text, tagline_fr text, tagline_es text, tagline_pt text, tagline_zh text,
  description text,
  description_nl text, description_de text, description_fr text,
  description_es text, description_pt text, description_zh text,

  -- Pricing display (actual price comes live from FareHarbor API)
  price_display text,       -- e.g. "From €165" or "€35 p.p."
  price_label text,         -- e.g. "per boat" or "per person"
  starting_price numeric,   -- used for sorting / display

  hero_image_url text,

  -- ── 3-Layer Filter System ──────────────────────────────
  -- Layer 1: which boats (FH resource PKs) are allowed
  allowed_resource_pks bigint[] DEFAULT '{}',
  -- Layer 2: which durations/types (FH customer type PKs) are allowed
  allowed_customer_type_pks bigint[] DEFAULT '{}',
  -- Layer 3: time/date rules (applied in filters.ts)
  -- Examples: {"time_after":"17:00"} | {"max_guests_override":2} | {"months":[6,7,8]}
  availability_filters jsonb DEFAULT '{}',
  -- ──────────────────────────────────────────────────────

  display_order integer DEFAULT 0,
  is_published boolean DEFAULT false,
  is_featured boolean DEFAULT false,
  category text DEFAULT 'standard',   -- 'private' | 'shared' | 'standard'

  departure_location text DEFAULT 'Keizersgracht 62, Amsterdam',

  -- SEO (English base + 6 languages)
  seo_title text,
  seo_meta_description text,
  seo_title_nl text, seo_title_de text, seo_title_fr text,
  seo_title_es text, seo_title_pt text, seo_title_zh text,
  seo_meta_description_nl text, seo_meta_description_de text, seo_meta_description_fr text,
  seo_meta_description_es text, seo_meta_description_pt text, seo_meta_description_zh text,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.cruise_listings ENABLE ROW LEVEL SECURITY;

-- Public can read published listings
CREATE POLICY "public_read" ON public.cruise_listings
  FOR SELECT USING (is_published = true);

-- Service role (admin) has full access
CREATE POLICY "admin_all" ON public.cruise_listings
  FOR ALL USING (true);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cruise_listings_updated_at
  BEFORE UPDATE ON public.cruise_listings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
