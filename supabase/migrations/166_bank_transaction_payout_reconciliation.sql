-- 166_bank_transaction_payout_reconciliation.sql
-- Omzetkanalen & Kasboek Auto-Reconciliatie.
--
-- Links incoming bank_transactions (Revolut deposits) to their corresponding
-- payout records from revenue channels (Viator, GetYourGuide, BoatLocal, FareHarbor, etc.).

ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS payout_channel text,
  ADD COLUMN IF NOT EXISTS payout_record_id text,
  ADD COLUMN IF NOT EXISTS payout_reference text,
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;

CREATE INDEX IF NOT EXISTS bank_transactions_payout_idx
  ON public.bank_transactions (payout_channel, payout_record_id)
  WHERE payout_channel IS NOT NULL;

-- Also let payout tables reference the matching bank transaction
ALTER TABLE public.viator_payment_batches
  ADD COLUMN IF NOT EXISTS bank_transaction_id uuid REFERENCES public.bank_transactions(id) ON DELETE SET NULL;

ALTER TABLE public.getyourguide_payments
  ADD COLUMN IF NOT EXISTS bank_transaction_id uuid REFERENCES public.bank_transactions(id) ON DELETE SET NULL;

ALTER TABLE public.boatlocal_payout_batches
  ADD COLUMN IF NOT EXISTS bank_transaction_id uuid REFERENCES public.bank_transactions(id) ON DELETE SET NULL;
