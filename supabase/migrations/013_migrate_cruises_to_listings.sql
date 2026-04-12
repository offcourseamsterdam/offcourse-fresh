-- Migrate content data from old `cruises` table into `cruise_listings`.
-- Matches rows by slug. Overwrites existing content. Creates new listings
-- for cruises that don't have a matching cruise_listing yet.

-- Step 1: UPDATE existing cruise_listings where slug matches
UPDATE cruise_listings cl SET
  title = c.cruise_name,
  title_nl = c.cruise_name_nl,
  title_de = c.cruise_name_de,
  title_fr = c.cruise_name_fr,
  title_es = c.cruise_name_es,
  title_pt = c.cruise_name_pt,
  title_zh = c.cruise_name_zh,
  tagline = c.tagline,
  tagline_nl = c.tagline_nl,
  tagline_de = c.tagline_de,
  tagline_fr = c.tagline_fr,
  tagline_es = c.tagline_es,
  tagline_pt = c.tagline_pt,
  tagline_zh = c.tagline_zh,
  description = c.description,
  description_nl = c.description_nl,
  description_de = c.description_de,
  description_fr = c.description_fr,
  description_es = c.description_es,
  description_pt = c.description_pt,
  description_zh = c.description_zh,
  departure_location = c.departure_location,
  starting_price = c.starting_price,
  price_label = c.price_label,
  duration_display = c.duration,
  category = c.cruise_type,
  seo_title = c.seo_title,
  seo_title_nl = c.seo_title_nl,
  seo_title_de = c.seo_title_de,
  seo_title_fr = c.seo_title_fr,
  seo_title_es = c.seo_title_es,
  seo_title_pt = c.seo_title_pt,
  seo_title_zh = c.seo_title_zh,
  seo_meta_description = c.seo_meta_description,
  seo_meta_description_nl = c.seo_meta_description_nl,
  seo_meta_description_de = c.seo_meta_description_de,
  seo_meta_description_fr = c.seo_meta_description_fr,
  seo_meta_description_es = c.seo_meta_description_es,
  seo_meta_description_pt = c.seo_meta_description_pt,
  seo_meta_description_zh = c.seo_meta_description_zh,
  is_published = c.is_published,
  updated_at = now()
FROM cruises c
WHERE cl.slug = c.slug;

-- Step 2: INSERT new cruise_listings for cruises without a matching listing
INSERT INTO cruise_listings (
  slug,
  title, title_nl, title_de, title_fr, title_es, title_pt, title_zh,
  tagline, tagline_nl, tagline_de, tagline_fr, tagline_es, tagline_pt, tagline_zh,
  description, description_nl, description_de, description_fr, description_es,
  description_pt, description_zh,
  departure_location, starting_price, price_label, duration_display, category,
  seo_title, seo_title_nl, seo_title_de, seo_title_fr, seo_title_es,
  seo_title_pt, seo_title_zh,
  seo_meta_description, seo_meta_description_nl, seo_meta_description_de,
  seo_meta_description_fr, seo_meta_description_es, seo_meta_description_pt,
  seo_meta_description_zh,
  is_published, fareharbor_item_pk,
  allowed_resource_pks, allowed_customer_type_pks, availability_filters,
  benefits, highlights, inclusions, faqs, images,
  display_order, is_featured
)
SELECT
  c.slug,
  c.cruise_name, c.cruise_name_nl, c.cruise_name_de, c.cruise_name_fr,
  c.cruise_name_es, c.cruise_name_pt, c.cruise_name_zh,
  c.tagline, c.tagline_nl, c.tagline_de, c.tagline_fr, c.tagline_es,
  c.tagline_pt, c.tagline_zh,
  c.description, c.description_nl, c.description_de, c.description_fr,
  c.description_es, c.description_pt, c.description_zh,
  c.departure_location, c.starting_price, c.price_label, c.duration, c.cruise_type,
  c.seo_title, c.seo_title_nl, c.seo_title_de, c.seo_title_fr, c.seo_title_es,
  c.seo_title_pt, c.seo_title_zh,
  c.seo_meta_description, c.seo_meta_description_nl, c.seo_meta_description_de,
  c.seo_meta_description_fr, c.seo_meta_description_es, c.seo_meta_description_pt,
  c.seo_meta_description_zh,
  c.is_published, 234922,
  '{}', '{}', '{}',
  '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
  0, false
FROM cruises c
WHERE NOT EXISTS (SELECT 1 FROM cruise_listings cl WHERE cl.slug = c.slug);
