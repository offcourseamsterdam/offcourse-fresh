-- 048_promo_codes_discount_scope.sql
-- Add discount_scope to promo_codes so a code can specify which part of the
-- total it applies to. The WeBikeAmsterdam case: their 100%-off code should
-- cover the cruise + city tax only, NOT the customer's drinks/food extras.
--
-- Scopes:
--   'cruise'  — discount applies to base + city tax only (extras pay full)
--   'all'     — discount applies to grand total (base + city tax + extras)
--
-- Default 'cruise' for new codes (the safer / more common semantic).
-- Backfill: existing partner-style 100%-off codes get 'cruise' too.

ALTER TABLE promo_codes
  ADD COLUMN IF NOT EXISTS discount_scope text NOT NULL DEFAULT 'cruise'
    CHECK (discount_scope IN ('cruise', 'all'));

COMMENT ON COLUMN promo_codes.discount_scope IS
  'What the discount applies to. ''cruise'' = base + city tax only; ''all'' = grand total including extras. Default ''cruise''.';

-- Migrate WeBikeAmsterdam listing off partner_invoice mode.
-- The promo code (campaign-scoped, discount_scope=''cruise'') replaces partner_codes.
-- Customer pays for extras via Stripe; cruise + city tax = €0 covered by partner.
UPDATE cruise_listings
   SET payment_mode = 'stripe',
       required_partner_id = NULL
 WHERE slug = 'we-bike-amsterdam-hidden-gems-canal-cruise-small-group';
