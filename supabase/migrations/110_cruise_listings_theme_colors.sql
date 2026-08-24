-- 110_cruise_listings_theme_colors.sql
-- Optional per-listing accent-color override (hex strings), e.g. Jamaican
-- green/red for the Curaçao Jamaican Buffet Cruise. Mirrors the existing
-- isSpecialEvent rainbow-theme pattern (Pride Amsterdam) but data-driven per
-- listing instead of a hardcoded slug lookup, since Beer expects more
-- culturally-themed food-cruise listings going forward, each potentially
-- needing its own palette.
--
-- Both null (the default) = the site's normal indigo/crimson theme. Both must
-- be set for the override to apply — see [slug]/page.tsx.
ALTER TABLE cruise_listings
  ADD COLUMN IF NOT EXISTS theme_primary_color text,
  ADD COLUMN IF NOT EXISTS theme_accent_color text;

COMMENT ON COLUMN cruise_listings.theme_primary_color IS
  'Hex color overriding --color-primary (main heading, buttons, selected states) for just this listing''s page. Leave null for the default site indigo.';
COMMENT ON COLUMN cruise_listings.theme_accent_color IS
  'Hex color overriding --color-accent (section headings) for just this listing''s page. Leave null for the default site crimson.';
