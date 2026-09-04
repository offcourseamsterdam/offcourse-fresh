-- 154_obligations_source_key.sql
-- Derived obligations (city tax, VAT, recurring charges, skipper hours — plan
-- §12b/12c) need an idempotent handle: confirming the same proposal twice
-- must not create the row twice. source_key carries that handle
-- ('city-tax:2026-Q2', 'vat:2026-Q2', 'recurring:supabase', 'skipper-hours:2026-08:<staffId>')
-- and the partial unique index enforces it — NULL for every manually entered
-- obligation, which is never derived and so never idempotency-checked.

ALTER TABLE public.finance_obligations ADD COLUMN IF NOT EXISTS source_key text;

CREATE UNIQUE INDEX IF NOT EXISTS finance_obligations_source_key_idx
  ON public.finance_obligations (source_key)
  WHERE source_key IS NOT NULL;
