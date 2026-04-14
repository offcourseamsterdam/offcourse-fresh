-- Consolidate three groups of tables:
-- 1. fareharbor_resources + fareharbor_customer_types → JSONB on fareharbor_items
-- 2. merch_images → JSONB on merch_products
-- 3. team_members + float_fam_members → unified people table

-- ── 1. FareHarbor ─────────────────────────────────────────────────────────────
-- Resources and customer types are a small, always-loaded-together cache.
-- Storing them as JSONB on the item row eliminates 2 tables and 2 extra queries.

ALTER TABLE public.fareharbor_items
  ADD COLUMN IF NOT EXISTS resources jsonb DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS customer_types jsonb DEFAULT '[]';

DROP TABLE IF EXISTS public.fareharbor_resources CASCADE;
DROP TABLE IF EXISTS public.fareharbor_customer_types CASCADE;

-- ── 2. Merch images ───────────────────────────────────────────────────────────
-- A product has at most a handful of images, always loaded with the product.
-- Same pattern as cruise_listings.images.

ALTER TABLE public.merch_products
  ADD COLUMN IF NOT EXISTS images jsonb DEFAULT '[]';

DROP TABLE IF EXISTS public.merch_images CASCADE;

-- ── 3. People ─────────────────────────────────────────────────────────────────
-- team_members and float_fam_members have near-identical columns.
-- A single people table with a type discriminator is simpler to admin.

CREATE TABLE IF NOT EXISTS public.people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('team', 'float_fam')),
  name text NOT NULL,
  role text,
  bio text,
  image_url text,
  faqs jsonb DEFAULT '[]',
  display_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public_read" ON public.people FOR SELECT USING (true);
CREATE POLICY "admin_all" ON public.people FOR ALL USING (true);

-- Migrate float_fam_members (message → bio)
INSERT INTO public.people (type, name, role, bio, display_order, is_active, created_at)
SELECT 'float_fam', name, role, message, display_order, is_active, created_at
FROM public.float_fam_members;

-- Migrate team_members (photo_url → image_url, Q&A pairs → faqs JSONB)
INSERT INTO public.people (type, name, role, image_url, faqs, display_order, is_active, created_at)
SELECT
  'team', name, role, photo_url,
  (
    SELECT COALESCE(jsonb_agg(pair), '[]'::jsonb)
    FROM (
      VALUES
        (CASE WHEN question_1 IS NOT NULL THEN jsonb_build_object('q', question_1, 'a', answer_1) END),
        (CASE WHEN question_2 IS NOT NULL THEN jsonb_build_object('q', question_2, 'a', answer_2) END),
        (CASE WHEN question_3 IS NOT NULL THEN jsonb_build_object('q', question_3, 'a', answer_3) END),
        (CASE WHEN question_4 IS NOT NULL THEN jsonb_build_object('q', question_4, 'a', answer_4) END)
    ) AS t(pair)
    WHERE pair IS NOT NULL
  ),
  display_order, is_active, created_at
FROM public.team_members;

DROP TABLE IF EXISTS public.team_members CASCADE;
DROP TABLE IF EXISTS public.float_fam_members CASCADE;
