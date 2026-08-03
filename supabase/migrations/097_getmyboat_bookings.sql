-- GetMyBoat revenue — one row per booking. Getmyboat, Inc. (a US company)
-- sends a "Getmyboat has sent you money" email per payout (no attachment,
-- HTML body only), listing every booking rolled into that payout by its own
-- numeric booking id — the same id also appears in the per-booking "Booking
-- Confirmed!" email and in the getmyboat.com/admin/transactions/ portal, so
-- matching is an exact id match, not a fuzzy prefix like Withlocals.
--
-- No CSV/portal export exists for this source (unlike Click & Boat) and
-- volume is low, so this is parsed straight from the payout email's visible
-- text, the same way Withlocals' payout side is — see getmyboat-payout.ts.
--
-- 9% output VAT is derived from the NET amount (what Getmyboat actually
-- pays out), not the gross "Base Cost" shown in the booking confirmation
-- email — Beer confirmed this explicitly, same convention as Click & Boat/
-- GetYourGuide/Viator (Withlocals is the one exception that uses gross).
create table if not exists getmyboat_bookings (
  id uuid primary key default gen_random_uuid(),
  booking_id text not null unique,          -- Getmyboat's own numeric id, e.g. "5680543"
  guest_name text,
  charter_date date,
  net_amount_cents integer not null,        -- the VAT base — what Getmyboat actually paid out
  revenue_vat_rate integer not null default 9,
  payout_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Admin-only: writes go through the API route (service role), same as the
-- other finance tables. No anon access.
alter table getmyboat_bookings enable row level security;

create policy "service_role_full_access" on getmyboat_bookings
  for all
  using ((auth.jwt() ->> 'role'::text) = 'service_role'::text);
