-- Tag substrate for programmatic listings + tag-aware image picker
-- Additive only: existing rows default to empty arrays. Backward compatible.
-- See docs/plans/ for the broader Phase 1 design.

ALTER TABLE public.image_assets
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.cruise_listings
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

-- GIN indexes enable fast `tags @> ARRAY[...]` containment queries
-- (used by the public listings filter page).
CREATE INDEX IF NOT EXISTS image_assets_tags_gin_idx
  ON public.image_assets USING gin (tags);

CREATE INDEX IF NOT EXISTS cruise_listings_tags_gin_idx
  ON public.cruise_listings USING gin (tags);
