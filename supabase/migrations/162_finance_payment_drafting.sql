-- 162_finance_payment_drafting.sql
-- Payment drafting from Obligations & Expense Records (docs/plans/2026-09-05-payment-drafting.md).
-- Reuses finance_suppliers.iban / .revolut_counterparty_id — nothing new to validate there.

ALTER TABLE public.finance_obligations
  ADD COLUMN supplier_id uuid REFERENCES public.finance_suppliers(id) ON DELETE SET NULL,
  ADD COLUMN revolut_draft_id text;
CREATE INDEX finance_obligations_supplier_id_idx ON public.finance_obligations (supplier_id);
COMMENT ON COLUMN public.finance_obligations.revolut_draft_id IS 'Set once a Revolut payment draft exists for the CURRENT due occurrence. Cleared when the linked supplier changes, or when mark-paid rolls a recurring obligation to its next due date — each occurrence needs its own draft.';

ALTER TABLE public.finance_expenses ADD COLUMN revolut_draft_id text;
COMMENT ON COLUMN public.finance_expenses.revolut_draft_id IS 'Set once a Revolut payment draft exists for a waiting_for_payment record (an invoice arrived before its payment did). Never set once bank_transaction_id is present — that payment already happened.';
