-- ── Promo codes ────────────────────────────────────────────────────────────
-- Unified discount/voucher system.
-- Covers marketing promos (percentage/fixed_amount) and partner redemptions (full).
-- Codes work globally on any listing; no listing-level restriction.

CREATE TABLE promo_codes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  text UNIQUE NOT NULL,         -- normalised: XXXX-XXXX uppercase
  label                 text NOT NULL,                -- e.g. "Summer 2026" or "Webikeamsterdam"
  discount_type         text NOT NULL                 -- 'percentage' | 'fixed_amount' | 'full'
                          CHECK (discount_type IN ('percentage', 'fixed_amount', 'full')),
  discount_value        numeric(5,2),                 -- for percentage: e.g. 10.00 = 10%
  fixed_discount_cents  integer,                      -- for fixed_amount: e.g. 2000 = €20
  max_uses              integer,                      -- NULL = unlimited
  uses_count            integer NOT NULL DEFAULT 0,
  valid_from            timestamptz,                  -- NULL = valid immediately
  valid_until           timestamptz,                  -- NULL = never expires
  is_active             boolean NOT NULL DEFAULT true,
  partner_id            uuid REFERENCES partners(id), -- optional link to partner
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),

  -- Type consistency: percentage codes need discount_value, fixed needs fixed_discount_cents
  CONSTRAINT percentage_needs_value
    CHECK (discount_type <> 'percentage' OR discount_value IS NOT NULL),
  CONSTRAINT fixed_needs_cents
    CHECK (discount_type <> 'fixed_amount' OR fixed_discount_cents IS NOT NULL)
);

-- Fast lookup by code (the hot path on every checkout validation)
CREATE INDEX promo_codes_code_idx ON promo_codes (code) WHERE is_active;
-- Expiry sweep
CREATE INDEX promo_codes_expiry_idx ON promo_codes (valid_until) WHERE is_active AND valid_until IS NOT NULL;

-- RLS: only service role (admin API routes via createAdminClient)
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON promo_codes USING (auth.role() = 'service_role');

-- ── Extend bookings ─────────────────────────────────────────────────────────

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS promo_code_id       uuid REFERENCES promo_codes(id),
  ADD COLUMN IF NOT EXISTS discount_amount_cents integer NOT NULL DEFAULT 0;
