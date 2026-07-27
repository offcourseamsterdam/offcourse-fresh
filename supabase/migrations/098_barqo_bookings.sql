-- Barqo revenue — one row per booking. Barqo (barqo.nl, operated by BAB NL
-- B.V.) is a peer-to-peer boat rental marketplace where Off Course's boat
-- Diana is listed. Booking-request notifications land in the BoatLocal
-- mailbox (bookings@boatlocal.nl), not offcourseamsterdam.com — easy to miss.
--
-- Very low volume (2 real bookings total, ever, as of this migration) and
-- no recurring payout email/CSV export exists to parse — the dashboard at
-- barqo.co/dashboard/booking-overview is the only source, read by hand/agent
-- and saved via a plain upsert API, the same pattern as Zettle (no file to
-- upload, no document to parse).
--
-- Both known bookings (Sabine, 13-07-2025, €300; Frank, 26-06-2025, €300)
-- predate Off Course's own Stripe account going live (~March 2026) — the
-- price shown on the dashboard is a single gross figure with no visible
-- commission breakdown, so it doubles as the VAT base until told otherwise.
-- If Barqo's payment flow now runs through Off Course's own Stripe account
-- (acct_1T8kWuGh1qCF71Ta, confirmed the same account behind
-- STRIPE_SECRET_KEY), any FUTURE booking may already be captured by the
-- normal Stripe webhook/vat-stripe-summary — check before assuming this
-- table needs new rows going forward.
create table if not exists barqo_bookings (
  id uuid primary key default gen_random_uuid(),
  booking_number text not null unique,      -- Barqo's own code, e.g. "BJL4QP"
  guest_name text,
  boat_name text,
  trip_date date,
  price_cents integer not null,              -- the VAT base — no separate gross/net split visible on the dashboard
  revenue_vat_rate integer not null default 9,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Admin-only: writes go through the API route (service role), same as the
-- other finance tables. No anon access.
alter table barqo_bookings enable row level security;

create policy "service_role_full_access" on barqo_bookings
  for all
  using ((auth.jwt() ->> 'role'::text) = 'service_role'::text);
