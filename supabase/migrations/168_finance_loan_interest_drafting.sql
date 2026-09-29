-- 168_finance_loan_interest_drafting.sql
-- Semi-annual interest payments (1 April / 1 October) are drafted in Revolut automatically.
-- Reuses finance_suppliers.iban / .revolut_counterparty_id for the lender's bank details, so a
-- lender's IBAN lives in exactly one place and every draft path validates it the same way.

ALTER TABLE public.finance_loans
  ADD COLUMN supplier_id uuid REFERENCES public.finance_suppliers(id) ON DELETE SET NULL;
CREATE INDEX finance_loans_supplier_id_idx ON public.finance_loans (supplier_id);
COMMENT ON COLUMN public.finance_loans.supplier_id IS 'The lender as a payee (finance_suppliers row holding IBAN + Revolut counterparty). Null = interest cannot be drafted yet.';

ALTER TABLE public.finance_loan_payments
  ADD COLUMN revolut_draft_id text,
  ADD COLUMN drafted_at timestamptz;
COMMENT ON COLUMN public.finance_loan_payments.revolut_draft_id IS 'Revolut payment draft for this period''s INTEREST (never principal). Set once; guards the cron against drafting the same period twice. Beer still approves it in the Revolut app.';
