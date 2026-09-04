-- 156_finance_inbox_pipeline.sql
-- Financial Management Module — §6 Finance Inbox: the inbound-invoice pipeline.
-- Plan: docs/plans/2026-09-04-financial-management-module.md §4, §6.
--
-- Two tables: who we pay (finance_suppliers) and what we're checking before we pay them
-- (finance_invoices). Delivery (§6a — GMAIL_FINANCE_ADDRESS, source_category) already
-- shipped in migration 155; this is the extraction/match/approve pipeline itself.
--
-- All new tables: RLS ON with zero policies = service-role only, same convention as 148.

CREATE TABLE public.finance_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  -- Set for a skipper being paid for hours worked (matched against `shifts` via this).
  -- Null for a non-skipper supplier (marina, insurer, chandlery, ...).
  staff_id uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  email text,
  iban text,
  bic text,
  revolut_counterparty_id text,
  default_category text,
  default_boat_id uuid REFERENCES public.boats(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.finance_suppliers IS 'Known senders at the finance inbox — skippers (staff_id set) and non-skipper suppliers. Resolved by IBAN first, then name (see invoices/match.ts).';
ALTER TABLE public.finance_suppliers ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.finance_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid REFERENCES public.finance_suppliers(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'extracted', 'needs_review', 'ready', 'approved', 'payment_pending', 'paid', 'reconciled', 'rejected')),
  -- Private 'finance-attachments' bucket path (src/lib/finance/attachment-storage.ts).
  file_path text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('upload', 'email')),
  -- Set only when source='email' — the inbox message this PDF was attached to.
  source_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  -- {invoice_number, invoice_date, supplier_name, iban, tour_date, booking_ref, hours,
  --  rate_cents, amount_cents, vat_cents, confidence: {field: 0..1}} — see invoices/extract.ts.
  -- A field Gemini couldn't find is 'Niet gevonden', never guessed.
  extracted jsonb,
  matched_shift_id uuid REFERENCES public.shifts(id) ON DELETE SET NULL,
  matched_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  expected_amount_cents integer,
  -- [{key: 'skipper'|'booking'|'date'|'amount'|'duplicate'|'iban'|'hours'|'rate', ok: bool, detail}]
  checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  decision text CHECK (decision IN ('approved', 'approved_override', 'rejected')),
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  revolut_draft_id text,
  paid_transaction_id uuid REFERENCES public.bank_transactions(id) ON DELETE SET NULL,
  obligation_id uuid REFERENCES public.finance_obligations(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.finance_invoices IS 'One row per invoice PDF (uploaded or emailed to GMAIL_FINANCE_ADDRESS), from receipt through Gemini extraction, shift/booking matching, checks, approval and payment. See docs/plans/2026-09-04-financial-management-module.md §6.';
COMMENT ON COLUMN public.finance_invoices.checks IS 'Per-field pass/fail from invoices/match.ts, computed at match time — never re-derived on read, so an approved invoice keeps the checks it was actually approved against.';
CREATE INDEX finance_invoices_status_idx ON public.finance_invoices (status);
CREATE INDEX finance_invoices_supplier_id_idx ON public.finance_invoices (supplier_id);
ALTER TABLE public.finance_invoices ENABLE ROW LEVEL SECURITY;
