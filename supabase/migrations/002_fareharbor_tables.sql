-- FareHarbor reference cache
-- Downloaded from the FH API via the admin panel.
-- These tables exist so the admin can see boat names and PKs
-- when configuring cruise listings. The booking flow does NOT
-- depend on these tables at runtime.

CREATE TABLE IF NOT EXISTS public.fareharbor_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fareharbor_pk bigint UNIQUE NOT NULL,
  name text NOT NULL,
  shortname text NOT NULL DEFAULT 'offcourse',
  item_type text NOT NULL CHECK (item_type IN ('private', 'shared')),
  is_active boolean DEFAULT true,
  last_synced_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fareharbor_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fareharbor_item_id uuid REFERENCES public.fareharbor_items(id) ON DELETE CASCADE,
  fareharbor_pk bigint UNIQUE NOT NULL,
  name text NOT NULL,
  capacity integer NOT NULL DEFAULT 1,
  last_synced_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fareharbor_customer_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fareharbor_item_id uuid REFERENCES public.fareharbor_items(id) ON DELETE CASCADE,
  fareharbor_pk bigint UNIQUE NOT NULL,
  name text NOT NULL,
  boat_name text NOT NULL,
  duration_minutes integer NOT NULL,
  max_guests integer NOT NULL,
  price_cents integer,
  last_synced_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.fareharbor_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fareharbor_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fareharbor_customer_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all" ON public.fareharbor_items FOR ALL USING (true);
CREATE POLICY "admin_all" ON public.fareharbor_resources FOR ALL USING (true);
CREATE POLICY "admin_all" ON public.fareharbor_customer_types FOR ALL USING (true);
