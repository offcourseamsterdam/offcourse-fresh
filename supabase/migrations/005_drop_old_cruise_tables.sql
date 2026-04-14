-- Drop old normalized cruise content tables.
-- These are replaced by JSONB columns on cruise_listings (migration 004).
-- benefits, highlights, inclusions, faqs, images, cancellation_policy
-- are now stored directly on the listing row.

DROP TABLE IF EXISTS public.cruise_listing_faqs CASCADE;
DROP TABLE IF EXISTS public.cruise_listing_benefits CASCADE;
DROP TABLE IF EXISTS public.cruise_listing_images CASCADE;
DROP TABLE IF EXISTS public.cruise_benefits CASCADE;
DROP TABLE IF EXISTS public.cruise_cancellation_policies CASCADE;
DROP TABLE IF EXISTS public.cruise_faqs CASCADE;
DROP TABLE IF EXISTS public.cruise_highlights CASCADE;
DROP TABLE IF EXISTS public.cruise_images CASCADE;
DROP TABLE IF EXISTS public.cruise_inclusions CASCADE;
