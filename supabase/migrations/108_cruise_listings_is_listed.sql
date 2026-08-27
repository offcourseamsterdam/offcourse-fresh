-- 108_cruise_listings_is_listed.sql
-- Lets a published listing stay reachable by direct URL (no 404) while being
-- excluded from every discovery surface: nav dropdown, /cruises browse page,
-- sitemap, and homepage search results. Use case: link-only listings shared
-- privately (e.g. a partner's branded cruise page) that shouldn't show up in
-- site navigation or search engines.
--
-- Default true means every existing listing keeps behaving exactly as before.
ALTER TABLE cruise_listings
  ADD COLUMN IF NOT EXISTS is_listed boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN cruise_listings.is_listed IS
  'false = link-only: is_published still gates the direct /cruises/{slug} page (no 404), but the listing is hidden from nav, /cruises, sitemap.xml, and homepage search results.';
