-- Image Optimization pipeline
-- Creates image_assets table to track every uploaded image through its
-- lifecycle: pending → processing → complete (or failed).
-- Existing image-bearing tables get optional FK references to image_assets.

CREATE TABLE IF NOT EXISTS image_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Provenance
  context TEXT NOT NULL,           -- 'cruise' | 'extras' | 'hero' | 'boat' | 'priorities' | 'people'
  context_id TEXT,                 -- e.g. cruise_listings.id
  original_url TEXT NOT NULL,      -- raw upload URL (in _originals/ subfolder)
  original_path TEXT,              -- Supabase storage path (for cleanup)
  bucket TEXT,                     -- Supabase bucket name
  mime_type TEXT,
  file_size_bytes BIGINT,
  sha256 TEXT NOT NULL,

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'pending',
  failure_reason TEXT,

  -- Processed output
  base_filename TEXT,              -- e.g. 'amsterdam-canal-cruise-diana-sunset'
  variants JSONB,                  -- [{ width, height, avif_url, webp_url, avif_size, webp_size }]
  blur_data_url TEXT,              -- data:image/webp;base64,...
  dominant_color TEXT,             -- '#c4a882'
  original_width INTEGER,
  original_height INTEGER,
  is_animated BOOLEAN DEFAULT FALSE,

  -- AI metadata (Gemini + Claude)
  alt_text JSONB,                  -- { en, nl, de, fr, es, pt, zh }
  caption JSONB,
  primary_keywords TEXT[],
  confidence NUMERIC(3,2),
  quality_issues TEXT[],

  -- Lifecycle timestamps
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_image_assets_sha256 ON image_assets(sha256);
CREATE INDEX IF NOT EXISTS idx_image_assets_status ON image_assets(status);
CREATE INDEX IF NOT EXISTS idx_image_assets_context ON image_assets(context, context_id);
CREATE INDEX IF NOT EXISTS idx_image_assets_created_at ON image_assets(created_at DESC);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION set_image_assets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_image_assets_updated_at ON image_assets;
CREATE TRIGGER trg_image_assets_updated_at
  BEFORE UPDATE ON image_assets
  FOR EACH ROW EXECUTE FUNCTION set_image_assets_updated_at();

-- RLS — public can read, only service role writes
ALTER TABLE image_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read on image_assets" ON image_assets;
CREATE POLICY "Public read on image_assets"
  ON image_assets FOR SELECT
  TO anon, authenticated
  USING (true);

-- Optional FK references on existing tables (no data migration — backward compatible)
ALTER TABLE cruise_listings
  ADD COLUMN IF NOT EXISTS hero_image_asset_id UUID REFERENCES image_assets(id) ON DELETE SET NULL;

ALTER TABLE extras
  ADD COLUMN IF NOT EXISTS image_asset_id UUID REFERENCES image_assets(id) ON DELETE SET NULL;

ALTER TABLE hero_carousel_items
  ADD COLUMN IF NOT EXISTS image_asset_id UUID REFERENCES image_assets(id) ON DELETE SET NULL;

COMMENT ON TABLE image_assets IS
  'Centralised image lifecycle: stores all variants (AVIF/WebP at 6 widths), AI-generated multilingual alt text, dominant color, blur placeholder, and processing status. Source of truth for image metadata across the site.';
