-- GetYourGuide sends one "Your payment is confirmed" email per payout, with
-- a PDF attachment (payment number, invoice number, amount, run date) and
-- the same figures in the email body. Unlike Viator's payment advice, there
-- is no per-booking breakdown here — one row per payout is the real grain.

CREATE TABLE IF NOT EXISTS getyourguide_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_number text UNIQUE NOT NULL,
  payment_run_date date,
  account_number text,
  invoice_number text,
  amount_cents integer,
  storage_path text,
  raw_filename text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE getyourguide_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON getyourguide_payments
  FOR ALL
  USING ((auth.jwt() ->> 'role'::text) = 'service_role'::text);
