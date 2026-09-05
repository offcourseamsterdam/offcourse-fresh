-- 160_finance_expenses.sql
-- Finance Inbox v2 — Expense Records (docs/plans/2026-09-05-finance-inbox-expense-records.md §2).
-- One row per cash-out event, joining a Revolut transaction, Revolut expense/receipt data and every
-- e-mailed/uploaded document about the same purchase, with the VAT figure and its provenance, on its
-- way to SnelStart. All new tables: RLS ON with zero policies = service-role only (same as 148–158).

CREATE SEQUENCE public.finance_expense_ref_seq;

CREATE TABLE public.finance_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'FIN-000123' — the human handle on cards, Slack, SnelStart subject lines. A sequence, not
  -- max()+1, so two records created in the same second never share a number.
  ref text NOT NULL UNIQUE DEFAULT ('FIN-' || lpad(nextval('public.finance_expense_ref_seq')::text, 6, '0')),
  status text NOT NULL DEFAULT 'waiting_for_invoice'
    CHECK (status IN ('ignored', 'waiting_for_invoice', 'waiting_for_payment', 'partially_matched', 'matched',
                      'needs_review', 'ready_for_snelstart', 'sent_to_snelstart', 'booked')),
  supplier_id uuid REFERENCES public.finance_suppliers(id) ON DELETE SET NULL,
  supplier_name text,
  -- payment side
  bank_transaction_id uuid REFERENCES public.bank_transactions(id) ON DELETE SET NULL,
  cash_out_cents integer,
  paid_at timestamptz,
  -- Revolut expense / receipt side
  revolut_expense_id text,
  revolut_expense_state text,
  revolut_vat_rate_pct numeric(5,2),
  revolut_vat_cents integer,
  -- document side (FKs to finance_documents added below, after that table exists)
  primary_document_id uuid,
  order_number text,
  invoice_number text,
  invoice_date date,
  -- accounting
  gross_cents integer,
  net_cents integer,
  vat_cents integer,
  vat_rate_pct numeric(5,2),
  vat_source text CHECK (vat_source IN ('invoice', 'receipt', 'revolut', 'ai', 'manual')),
  vat_conflict jsonb,
  -- matching
  match_confidence numeric(4,3),
  match_signals jsonb,
  matched_at timestamptz,
  -- SnelStart
  snelstart_sent_at timestamptz,
  snelstart_document_id uuid,
  snelstart_recipient text,
  snelstart_message_id text,
  booked_at timestamptz,
  -- review
  needs_review_reason text,
  reviewed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.finance_expenses IS 'One record per purchase / cash-out: Revolut transaction + Revolut expense/receipt + e-mailed documents + VAT with provenance, through matching to SnelStart. Plan: docs/plans/2026-09-05-finance-inbox-expense-records.md.';
COMMENT ON COLUMN public.finance_expenses.vat_conflict IS 'Set when two VAT sources disagree by more than €0,02, e.g. {"invoice": 2100, "revolut": 2000}. The record then sits in needs_review; a conflict is never overwritten silently (PRD §8).';
COMMENT ON COLUMN public.finance_expenses.match_signals IS 'Which signals fired for the accepted match, e.g. {"exactAmount": true, "supplierName": 0.92, "orderNumberInReference": true}. Explains match_confidence.';
CREATE UNIQUE INDEX finance_expenses_bank_transaction_id_key ON public.finance_expenses (bank_transaction_id) WHERE bank_transaction_id IS NOT NULL;
CREATE UNIQUE INDEX finance_expenses_revolut_expense_id_key ON public.finance_expenses (revolut_expense_id) WHERE revolut_expense_id IS NOT NULL;
CREATE INDEX finance_expenses_status_idx ON public.finance_expenses (status);
CREATE INDEX finance_expenses_paid_at_idx ON public.finance_expenses (paid_at);
CREATE INDEX finance_expenses_supplier_name_idx ON public.finance_expenses (lower(supplier_name));
ALTER TABLE public.finance_expenses ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.finance_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- null = orphan: arrived before its payment/expense exists (an invoice before the transfer,
  -- a Revolut receipt on an expense without transaction_id). The matcher keeps retrying these.
  expense_id uuid REFERENCES public.finance_expenses(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('invoice_pdf', 'receipt_image', 'revolut_receipt', 'order_confirmation_email',
                                     'invoice_notification_email', 'payment_confirmation_email', 'other_email', 'invoice_link')),
  source text NOT NULL CHECK (source IN ('email', 'revolut', 'upload')),
  source_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  revolut_expense_id text,
  revolut_receipt_id text,
  -- Private 'finance-attachments' bucket, server-generated key; null for a pure e-mail/link document.
  file_path text,
  original_filename text,
  mime_type text,
  sha256 text,
  -- {supplier_name, order_number, invoice_number, invoice_date, gross_cents, net_cents, vat_cents,
  --  vat_rate_pct, currency, iban, payment_reference, link_url, confidence: {field: 0..1}}
  extracted jsonb,
  link_url text,
  link_fetch_status text CHECK (link_fetch_status IN ('not_attempted', 'fetched', 'blocked', 'failed')),
  duplicate_of uuid REFERENCES public.finance_documents(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.finance_documents IS 'Every artefact about a purchase — PDF, receipt image, Revolut receipt, or a financially relevant e-mail without a file — stored once (sha256), pointing at its expense once matched.';
CREATE INDEX finance_documents_expense_id_idx ON public.finance_documents (expense_id);
CREATE INDEX finance_documents_source_message_id_idx ON public.finance_documents (source_message_id);
CREATE UNIQUE INDEX finance_documents_sha256_key ON public.finance_documents (sha256) WHERE sha256 IS NOT NULL;
CREATE UNIQUE INDEX finance_documents_revolut_receipt_id_key ON public.finance_documents (revolut_receipt_id) WHERE revolut_receipt_id IS NOT NULL;
-- Orphans are what the matcher scans on every new transaction; keep that scan cheap.
CREATE INDEX finance_documents_orphans_idx ON public.finance_documents (created_at) WHERE expense_id IS NULL;
ALTER TABLE public.finance_documents ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.finance_expenses
  ADD CONSTRAINT finance_expenses_primary_document_fk FOREIGN KEY (primary_document_id) REFERENCES public.finance_documents(id) ON DELETE SET NULL,
  ADD CONSTRAINT finance_expenses_snelstart_document_fk FOREIGN KEY (snelstart_document_id) REFERENCES public.finance_documents(id) ON DELETE SET NULL;

-- Reverse pointer for fast joins from the transactions list.
ALTER TABLE public.bank_transactions ADD COLUMN expense_id uuid REFERENCES public.finance_expenses(id) ON DELETE SET NULL;
CREATE INDEX bank_transactions_expense_id_idx ON public.bank_transactions (expense_id);

-- Kill switch for the hourly forward (plan §5, decision 2). Auto-forward only ever touches
-- ready_for_snelstart records; needs_review never goes out on its own.
ALTER TABLE public.finance_settings ADD COLUMN snelstart_auto_forward boolean NOT NULL DEFAULT true;
