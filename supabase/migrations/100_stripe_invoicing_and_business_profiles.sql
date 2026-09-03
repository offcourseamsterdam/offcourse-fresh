-- 100_stripe_invoicing_and_business_profiles.sql
-- Support for Stripe Invoicing (B2B / Op Factuur bookings) and business profile caching.

-- 1. Business Profiles Directory (caches company details for instant auto-complete)
CREATE TABLE IF NOT EXISTS public.business_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL,
  kvk_number text,
  vat_number text,
  contact_name text,
  contact_email text,
  contact_phone text,
  address_line1 text,
  postal_code text,
  city text,
  country_code text DEFAULT 'NL',
  stripe_customer_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_profiles_company_name ON public.business_profiles (company_name);
CREATE INDEX IF NOT EXISTS idx_business_profiles_kvk ON public.business_profiles (kvk_number);
CREATE INDEX IF NOT EXISTS idx_business_profiles_vat ON public.business_profiles (vat_number);

-- RLS on business_profiles
ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "business_profiles_service_all"
  ON public.business_profiles
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. Extend Bookings Table with Stripe Invoicing Columns
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS stripe_invoice_id text,
  ADD COLUMN IF NOT EXISTS stripe_invoice_url text,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS business_profile_id uuid REFERENCES public.business_profiles (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS company_name text,
  ADD COLUMN IF NOT EXISTS company_kvk text,
  ADD COLUMN IF NOT EXISTS company_vat text,
  ADD COLUMN IF NOT EXISTS company_address text,
  ADD COLUMN IF NOT EXISTS invoice_due_date text,
  ADD COLUMN IF NOT EXISTS payment_terms_days integer DEFAULT 14;

CREATE INDEX IF NOT EXISTS idx_bookings_business_profile_id
  ON public.bookings (business_profile_id);

CREATE UNIQUE INDEX IF NOT EXISTS bookings_stripe_invoice_id_unique
  ON public.bookings (stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;
