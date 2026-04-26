-- ============================================================
-- 032: Partner-invoiced virtual listings
--
-- Lets us turn a cruise_listing into a "partner-invoiced" storefront
-- (e.g. Webikeamsterdam). Such a listing:
--   - shows no online payment at checkout
--   - requires a rotating partner code typed from a physical receipt
--   - logs the booking against the partner so we invoice them later
-- ============================================================

-- 1) Extend cruise_listings
ALTER TABLE cruise_listings
  ADD COLUMN IF NOT EXISTS payment_mode text NOT NULL DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS required_partner_id uuid REFERENCES partners(id) ON DELETE SET NULL;

ALTER TABLE cruise_listings
  DROP CONSTRAINT IF EXISTS cruise_listings_payment_mode_check;

ALTER TABLE cruise_listings
  ADD CONSTRAINT cruise_listings_payment_mode_check
  CHECK (payment_mode IN ('stripe', 'partner_invoice'));

-- A partner-invoice listing must have a partner
ALTER TABLE cruise_listings
  DROP CONSTRAINT IF EXISTS cruise_listings_partner_invoice_needs_partner;

ALTER TABLE cruise_listings
  ADD CONSTRAINT cruise_listings_partner_invoice_needs_partner
  CHECK (payment_mode <> 'partner_invoice' OR required_partner_id IS NOT NULL);

-- 2) Rotating 3-month codes per partner
CREATE TABLE IF NOT EXISTS partner_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id  uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  code        text NOT NULL UNIQUE,
  issued_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  revoked_at  timestamptz,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS partner_codes_partner_idx ON partner_codes(partner_id);
CREATE INDEX IF NOT EXISTS partner_codes_active_lookup_idx ON partner_codes(code) WHERE is_active;
CREATE INDEX IF NOT EXISTS partner_codes_expiry_idx ON partner_codes(expires_at) WHERE is_active;

-- 3) RLS — admin work goes through service_role (createAdminClient), match existing pattern
ALTER TABLE partner_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS partner_codes_service_all ON partner_codes;
CREATE POLICY partner_codes_service_all ON partner_codes
  FOR ALL TO service_role USING (true);
