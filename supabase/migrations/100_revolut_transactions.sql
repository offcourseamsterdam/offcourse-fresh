-- Revolut Business ("Rederij Zoomers & Schenk" EUR Merchant account) — a
-- payment-link channel for direct sales that don't go through the main
-- website's Stripe checkout (custom cruise bookings sent via WhatsApp,
-- onboard drinks, merch, gifts). One row per customer payment ("Settlement"
-- row in Revolut's own CSV export) — the "Transfer" rows (payouts to the
-- bank) are NOT stored here; they already show up as their own lines in
-- Beer's bank ledger and carry no VAT information of their own.
--
-- Unlike every other kasboek source, a single transaction's own gross amount
-- can straddle BOTH VAT rates at once (a real example: "Vaartocht sail 22
-- augustus 2 uur + 2 t shirts", one €300.00 charge covering a 9% cruise
-- AND 21% merch in the same payment, confirmed split €250/€50 by Beer) —
-- hence two nullable gross-amount columns instead of one rate column. Both
-- null means "not yet classified" — free-text order descriptions are not
-- reliable enough to auto-classify (a real transaction, "Anniversary
-- ...drinks+charcuterie", read like 21% extras but Beer confirmed it's
-- actually 100% cruise at 9%), so every transaction needs a human to
-- confirm the split via POST .../revolut/classify before it counts toward
-- BTW-owed anywhere.
create table if not exists revolut_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_id text not null unique,       -- Revolut's own Transaction ID
  occurred_at date,                           -- settlement date ("Date & Time Started")
  description text,                           -- Order description (falls back to Description)
  customer_name text,
  original_amount_cents integer not null,     -- gross — what the customer actually paid
  settlement_amount_cents integer not null,   -- net of Revolut's own processing fee (informational)
  processing_fee_cents integer not null default 0, -- Revolut's own fee, stored positive (a cost)
  vat9_gross_cents integer,                   -- portion of original_amount_cents taxed at 9% (cruise) — null until classified
  vat21_gross_cents integer,                  -- portion of original_amount_cents taxed at 21% (drinks/merch) — null until classified
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table revolut_transactions enable row level security;

create policy "service_role_full_access" on revolut_transactions
  for all
  using ((auth.jwt() ->> 'role'::text) = 'service_role'::text);
