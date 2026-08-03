-- Click & Boat revenue — one row per booking. Click & Boat is a peer-to-peer
-- boat rental marketplace (CLICKANDBOAT SAS, France) that pays out per
-- booking, right after the trip (unlike the monthly-batched sources).
--
-- The whole thing is read off the "Download the summary" CSV export on
-- clickandboat.com/en/account/bookings — one file, re-downloaded and
-- re-uploaded periodically, containing every booking to date. Re-uploading
-- is a no-op for bookings already stored (upsert by charter_number, the
-- portal's own stable booking id).
--
-- Each booking also gets its own PDF invoice (Click & Boat's commission
-- bill to Off Course, reverse-charged EU VAT — a French company charging a
-- Dutch one) but that's paperwork/documentation, not something this table's
-- 9% calc depends on.
--
-- 9% output VAT is derived from the NET amount (what Click & Boat actually
-- transfers to Off Course), not the gross renter total — Beer confirmed
-- this explicitly for Click & Boat (a different answer than Withlocals,
-- where the accountant confirmed 9% over the GROSS tour price — don't
-- assume these two follow the same rule).
create table if not exists clickandboat_bookings (
  id uuid primary key default gen_random_uuid(),
  charter_number text not null unique,      -- Click & Boat's own booking id, e.g. "1208047"
  listing_title text,
  charter_start_date date,
  charter_end_date date,
  duration_days numeric,
  gross_amount_cents integer,                -- "Renter total (incl. insurances)" — reference only, NOT the VAT base
  net_amount_cents integer,                  -- "Net amount (boat owner)" — the VAT base
  revenue_vat_rate integer not null default 9,
  bank_transfer_date date,
  location text,
  raw_filename text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Admin-only: writes go through the API route (service role), same as the
-- other finance tables. No anon access.
alter table clickandboat_bookings enable row level security;

create policy "service_role_full_access" on clickandboat_bookings
  for all
  using ((auth.jwt() ->> 'role'::text) = 'service_role'::text);
