-- BoatLocal (Beer's other project) periodically pays Off Course its share of
-- bookings made through the BoatLocal platform — a genuine Off Course payout,
-- not "someone else's money" (see the Kasboek Bronnen correction). BoatLocal
-- emails one PDF invoice per month with a full VAT breakdown (9% on sales,
-- 21% on their commission) plus every underlying booking. Payouts land via
-- Stripe, same bank account as everything else.

CREATE TABLE IF NOT EXISTS boatlocal_payout_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text UNIQUE NOT NULL,
  issue_date date,
  period_start date,
  period_end date,
  total_sales_incl_vat_cents integer,
  total_sales_excl_vat_cents integer,
  commission_ex_vat_cents integer,
  vat_21_cents integer,
  total_withheld_cents integer,
  operator_payout_cents integer,
  vat_9_in_payout_cents integer,
  storage_path text,
  raw_filename text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS boatlocal_payout_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES boatlocal_payout_batches(id) ON DELETE CASCADE,
  booking_date date,
  guest_name text,
  guest_count integer,
  cruise_name text,
  total_cents integer,
  ex_vat_cents integer,
  incl_vat_cents integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- BoatLocal doesn't give us a booking reference, so date+guest+amount is
  -- the natural dedup key for a safe re-upload.
  UNIQUE (batch_id, booking_date, guest_name, total_cents)
);

CREATE INDEX IF NOT EXISTS idx_boatlocal_payout_lines_batch_id ON boatlocal_payout_lines(batch_id);

ALTER TABLE boatlocal_payout_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE boatlocal_payout_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON boatlocal_payout_batches
  FOR ALL
  USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

CREATE POLICY "service_role_full_access" ON boatlocal_payout_lines
  FOR ALL
  USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text);
