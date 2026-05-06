-- Server-canonical pricing: every customer-facing total is computed by the
-- /api/booking-flow/quote endpoint and stored here. /api/booking-flow/create-intent
-- accepts a quoteId (instead of trusting the browser's price). This eliminates
-- client/server drift in the pricing pipeline (extras × guests × hours, city tax,
-- promo discounts).
--
-- TTL: quotes expire after 10 minutes — long enough to fill in guest details,
-- short enough that pricing changes (deploys, FH price updates) take effect.

CREATE TABLE IF NOT EXISTS pricing_quotes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id      uuid REFERENCES cruise_listings(id) ON DELETE SET NULL,
  avail_pk        bigint NOT NULL,
  customer_type_rate_pk bigint,
  guest_count     integer NOT NULL,
  category        text NOT NULL,
  duration_minutes integer NOT NULL,
  selected_extra_ids uuid[] NOT NULL DEFAULT '{}',
  extra_quantities jsonb NOT NULL DEFAULT '{}'::jsonb,
  promo_code_id   uuid REFERENCES promo_codes(id) ON DELETE SET NULL,

  -- Computed totals (the values we charge against)
  base_price_cents      integer NOT NULL,
  server_base_amount_cents integer NOT NULL,
  extras_amount_cents   integer NOT NULL,
  city_tax_cents        integer NOT NULL,
  discount_amount_cents integer NOT NULL DEFAULT 0,
  total_cents           integer NOT NULL,

  -- Full breakdown stored so the UI can render line items without recomputing
  breakdown       jsonb NOT NULL,

  -- Lifecycle
  consumed_at     timestamptz,                       -- set when create-intent uses it
  consumed_intent_id text,                           -- Stripe PI id for traceability
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '10 minutes')
);

CREATE INDEX IF NOT EXISTS idx_pricing_quotes_expires_at ON pricing_quotes (expires_at);
CREATE INDEX IF NOT EXISTS idx_pricing_quotes_listing_id ON pricing_quotes (listing_id);

-- RLS: writes only via service role (API routes); no anon access.
ALTER TABLE pricing_quotes ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE pricing_quotes IS
  'Server-issued price quotes referenced by id at PaymentIntent creation. Source of truth for booking totals.';
