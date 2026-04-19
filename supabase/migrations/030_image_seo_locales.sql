-- Multi-locale alt-text + caption columns for image-bearing tables.
-- Pairs with the AI image-SEO tool in src/lib/ai/.
-- Each row gets one column per non-English locale; EN stays in the existing
-- alt_text / caption column where one exists.

-- ── hero_carousel_items ──────────────────────────────────────────────────
-- Already has alt_text + caption (English). Add 6 locale variants for both.
ALTER TABLE hero_carousel_items
  ADD COLUMN IF NOT EXISTS alt_text_nl text,
  ADD COLUMN IF NOT EXISTS alt_text_de text,
  ADD COLUMN IF NOT EXISTS alt_text_fr text,
  ADD COLUMN IF NOT EXISTS alt_text_es text,
  ADD COLUMN IF NOT EXISTS alt_text_pt text,
  ADD COLUMN IF NOT EXISTS alt_text_zh text,
  ADD COLUMN IF NOT EXISTS caption_nl  text,
  ADD COLUMN IF NOT EXISTS caption_de  text,
  ADD COLUMN IF NOT EXISTS caption_fr  text,
  ADD COLUMN IF NOT EXISTS caption_es  text,
  ADD COLUMN IF NOT EXISTS caption_pt  text,
  ADD COLUMN IF NOT EXISTS caption_zh  text;

-- ── priorities_cards ─────────────────────────────────────────────────────
-- Has alt_text (English). Add 6 locale variants. No caption field on this table.
ALTER TABLE priorities_cards
  ADD COLUMN IF NOT EXISTS alt_text_nl text,
  ADD COLUMN IF NOT EXISTS alt_text_de text,
  ADD COLUMN IF NOT EXISTS alt_text_fr text,
  ADD COLUMN IF NOT EXISTS alt_text_es text,
  ADD COLUMN IF NOT EXISTS alt_text_pt text,
  ADD COLUMN IF NOT EXISTS alt_text_zh text;

-- ── extras ───────────────────────────────────────────────────────────────
-- Had no alt_text at all. Add EN + 6 locales.
ALTER TABLE extras
  ADD COLUMN IF NOT EXISTS alt_text    text,
  ADD COLUMN IF NOT EXISTS alt_text_nl text,
  ADD COLUMN IF NOT EXISTS alt_text_de text,
  ADD COLUMN IF NOT EXISTS alt_text_fr text,
  ADD COLUMN IF NOT EXISTS alt_text_es text,
  ADD COLUMN IF NOT EXISTS alt_text_pt text,
  ADD COLUMN IF NOT EXISTS alt_text_zh text;

-- ── boats ────────────────────────────────────────────────────────────────
-- Three photo fields (open / covered / interior) × 7 locales = 21 values.
-- Stored as a single JSONB column to keep the row shape flat.
-- Shape: { open: { en, nl, de, fr, es, pt, zh }, covered: {...}, interior: {...} }
ALTER TABLE boats
  ADD COLUMN IF NOT EXISTS photo_alt_text jsonb DEFAULT '{}'::jsonb;

-- ── cruise_listings.images ───────────────────────────────────────────────
-- Already JSONB array. Each entry can now hold:
--   { url, alt_text: { en, nl, de, fr, es, pt, zh },
--         caption:  { en, nl, de, fr, es, pt, zh } }
-- No migration needed — enforced by application code.
