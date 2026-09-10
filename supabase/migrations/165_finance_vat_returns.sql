-- 165_finance_vat_returns.sql
-- Archive of the BTW-aangiftes actually filed by the accountant, as distinct from
-- computeBtwDashboard()'s per-source indication (btw-dashboard-calculator.ts) and the
-- vat:* finance_obligations row that indication proposes (cockpit/derived/vat.ts).
--
-- Why this needs its own table instead of just editing the finance_obligations row:
-- the indication has no memory of what was actually filed, so the moment a quarter's
-- BTW-aangifte lands (from New Financials, by e-mail into the Finance Inbox) there is
-- nowhere to keep the real number + the PDF itself — only the always-overwritten
-- estimate. Beer, 2026-09-10: Q1/Q2 2026's real aangiftes turned out to be refunds
-- (missing deductible VAT on a bank expense the dashboard doesn't see yet), while the
-- indication showed money owed — "Komende verplichtingen" was showing the wrong thing
-- for a quarter that was already filed and settled months earlier.
--
-- All new tables: RLS ON with zero policies = service-role only (same as 148–164).
CREATE TABLE public.finance_vat_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quarter text NOT NULL UNIQUE CHECK (quarter ~ '^\d{4}-Q[1-4]$'),
  filed_date date NOT NULL,
  -- Signed, same convention as the aangifte's own "5c Totaal": negative = wij ontvangen terug, positive = wij betalen.
  net_cents integer NOT NULL,
  vat9_owed_cents integer,
  vat21_owed_cents integer,
  voorbelasting_cents integer,
  -- Private 'finance-attachments' bucket, same as every other kasboek source document.
  file_path text NOT NULL,
  original_filename text,
  -- Set when the PDF arrived through the Finance Inbox (source_category='finance' e-mail
  -- thread) rather than a direct upload — traces back to the accountant's original message.
  source_document_id uuid REFERENCES public.finance_documents(id) ON DELETE SET NULL,
  -- Set once this filing has closed the matching vat:{quarter} finance_obligations row
  -- (derived/vat.ts's proposal) — null if no open obligation existed to close.
  obligation_id uuid REFERENCES public.finance_obligations(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.finance_vat_returns IS 'Archive of actually-filed BTW-aangiftes (real numbers + PDF), distinct from the auto-computed vat: obligation indication. Uploading one here closes the matching finance_obligations row with the real figure.';
CREATE INDEX finance_vat_returns_filed_date_idx ON public.finance_vat_returns (filed_date);
ALTER TABLE public.finance_vat_returns ENABLE ROW LEVEL SECURITY;
