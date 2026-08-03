-- Viator sends a monthly "Payment Advice" email (finance@viator.com) with an
-- .xlsx attachment listing every booking paid out in that transfer, plus the
-- total that lands in the bank. These two tables store that data once parsed,
-- so the Finance tab can show Viator income without re-reading the email
-- every time. batch = one payment advice document, lines = its line items.

CREATE TABLE IF NOT EXISTS viator_payment_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- document_number is NOT unique per advice — Viator reuses the same
  -- supplier document number (e.g. VI0000000274502) in every monthly
  -- filename. advice_date is what actually distinguishes one payment
  -- advice from the next, so the two together are the natural key.
  document_number text,
  advice_date date,
  total_amount_cents integer,
  raw_filename text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_number, advice_date)
);

CREATE TABLE IF NOT EXISTS viator_payment_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES viator_payment_batches(id) ON DELETE CASCADE,
  viator_reference text NOT NULL,
  arrival_date date,
  sale_date date,
  vendor_reference text,
  gross_amount numeric,
  gross_currency text,
  converted_amount_cents integer NOT NULL,
  tour_grade_code text,
  tour_grade_title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Same reference can legitimately appear twice (a charge + its reversal),
  -- so line identity is the reference plus its signed amount, not the
  -- reference alone — this is what makes re-uploading the same advice a no-op.
  UNIQUE (batch_id, viator_reference, converted_amount_cents)
);

CREATE INDEX IF NOT EXISTS idx_viator_payment_lines_batch_id ON viator_payment_lines(batch_id);

ALTER TABLE viator_payment_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE viator_payment_lines ENABLE ROW LEVEL SECURITY;

-- Admin-only data (financial records, no public read/write path) — mirrors
-- the service_role-only policy idiom from booking_claims (migration 083).
CREATE POLICY "service_role_full_access" ON viator_payment_batches
  FOR ALL
  USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text);

CREATE POLICY "service_role_full_access" ON viator_payment_lines
  FOR ALL
  USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text);
