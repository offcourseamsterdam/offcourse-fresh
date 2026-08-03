-- FareHarbor's own payment processing — historical/archief. FareHarbor
-- processed bookings' payments directly and paid Off Course out under the
-- bank descriptor "FHOFFCOURSE" (confirmed against Beer's bank ledger, "Opzet
-- tussenrekeningen 2025-2026") only until the site migrated to its own native
-- Stripe checkout in early May 2026 — the last FareHarbor payout in this
-- table lands 2026-05-03. Nothing new will ever land here going forward.
--
-- One row per FareHarbor Payout ID (their own batch id, e.g. "15217696"),
-- built by aggregating FareHarbor's "Sales-Payout Reconciliation" advanced
-- report (Detailed report, grouped by Payout ID, with Payout Date added —
-- the Summary report doesn't expose a date). FareHarbor already computes
-- the 9%/21% VAT split per line (BTW Laag/BTW Hoog columns), so unlike
-- Revolut there's nothing to classify — this is a direct read, not a guess.
-- Both 9% and 21% are OWED (verschuldigd): FareHarbor was Off Course's own
-- payment processor here, not a marketplace taking a commission, so there's
-- no deductible bucket the way BoatLocal/Withlocals/Barqo have one.
create table if not exists fareharbor_payouts (
  id uuid primary key default gen_random_uuid(),
  payout_id text not null unique,        -- FareHarbor's own Payout ID, e.g. "15217696" (no # prefix)
  payout_date date,                       -- when FareHarbor transferred the money to the bank
  gross_cents integer not null,
  processing_fee_cents integer not null,  -- FareHarbor's own fee, signed as FareHarbor reports it (negative)
  net_cents integer not null,
  subtotal_paid_cents integer not null,   -- ex-VAT base
  vat9_cents integer not null default 0,  -- "BTW Laag (9%) Paid" — owed, straight from FareHarbor's own report
  vat21_cents integer not null default 0, -- "BTW Hoog (21%) Paid" — owed
  tax_paid_cents integer not null default 0,
  line_count integer not null default 0,  -- number of underlying payment/refund detail rows
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table fareharbor_payouts enable row level security;

create policy "service_role_full_access" on fareharbor_payouts
  for all
  using ((auth.jwt() ->> 'role'::text) = 'service_role'::text);
