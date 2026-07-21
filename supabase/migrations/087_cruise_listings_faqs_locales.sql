-- Add per-locale FAQ columns to cruise_listings, matching the existing
-- title_nl/title_de/... pattern used for other translated fields. `faqs`
-- (the base English column) already exists; this adds the 6 locale variants.
ALTER TABLE cruise_listings
  ADD COLUMN IF NOT EXISTS faqs_nl jsonb,
  ADD COLUMN IF NOT EXISTS faqs_de jsonb,
  ADD COLUMN IF NOT EXISTS faqs_fr jsonb,
  ADD COLUMN IF NOT EXISTS faqs_es jsonb,
  ADD COLUMN IF NOT EXISTS faqs_pt jsonb,
  ADD COLUMN IF NOT EXISTS faqs_zh jsonb;
