-- Withlocals revenue — one row per booking. Withlocals is a marketplace that
-- sells Off Course cruises and pays out monthly. Its bookkeeping needs TWO
-- emails combined:
--   1. "New invoice for booking" (PDF, per booking) — the rich detail: tour
--      name, trip date, guests, gross tour price (revenue), Withlocals' service
--      fee (their commission, with 21% VAT that Off Course can deduct), and the
--      net payable to host.
--   2. "New payout" (monthly email, no attachment) — groups bookings into the
--      actual bank deposit and tells us WHEN each booking was paid.
--
-- One row here carries both: invoice fields are filled by the invoice upload,
-- payout_date by the payout email. A payout that arrives before its invoice is
-- ingested creates a stub row (net + guest + trip from the payout) that the
-- invoice later completes.
--
-- The 9% OUTPUT VAT on the cruise revenue is NOT stored per row from the
-- invoice (Withlocals doesn't state it) — `revenue_vat_rate` records the rate
-- (9% for canal cruises) and the split is derived in code. All money in cents.
create table if not exists withlocals_bookings (
  id uuid primary key default gen_random_uuid(),
  booking_id text not null unique,        -- Withlocals booking UUID (or 8-char short id from a payout-only stub)
  invoice_number text,
  invoice_date date,
  tour_name text,
  trip_at timestamptz,
  guest_count integer,
  guest_name text,                        -- only present in the payout email
  tour_price_cents integer,               -- gross revenue (incl output VAT)
  revenue_vat_rate integer not null default 9,
  service_fee_incl_cents integer,         -- Withlocals commission incl VAT
  service_fee_vat_cents integer,          -- 21% VAT on the commission (deductible)
  service_fee_ex_cents integer,
  net_payout_cents integer,               -- what Withlocals pays out
  payout_date date,                       -- from the payout email (bank date); null until paid
  storage_path text,                      -- stored invoice PDF
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Admin-only: writes go through the API route (service role), same as the
-- other finance tables. No anon access.
alter table withlocals_bookings enable row level security;
