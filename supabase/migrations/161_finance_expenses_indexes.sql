-- 161_finance_expenses_indexes.sql
-- Review follow-ups on migration 160 (2026-09-05 pre-landing review, data-migration + performance specialists).
--  * The Uitgaven list orders and cursor-pages on created_at with a status filter — index that shape.
--  * FK columns without indexes make every ON DELETE SET NULL a sequential scan of the referencing table.
--  * lower(supplier_name) is never usable: the only supplier_name predicate is a leading-wildcard ilike.
--  * lpad() TRUNCATES past 999999 ('FIN-1000000' → 'FIN-100000' = duplicate → every insert fails). Widen instead.
--  * The ref sequence should die with its table.

CREATE INDEX IF NOT EXISTS finance_expenses_status_created_at_idx ON public.finance_expenses (status, created_at DESC);
CREATE INDEX IF NOT EXISTS finance_expenses_created_at_idx ON public.finance_expenses (created_at DESC);
CREATE INDEX IF NOT EXISTS finance_expenses_primary_document_id_idx ON public.finance_expenses (primary_document_id);
CREATE INDEX IF NOT EXISTS finance_expenses_snelstart_document_id_idx ON public.finance_expenses (snelstart_document_id);
CREATE INDEX IF NOT EXISTS finance_expenses_supplier_id_idx ON public.finance_expenses (supplier_id);
CREATE INDEX IF NOT EXISTS finance_expenses_snelstart_pending_idx ON public.finance_expenses (snelstart_sent_at) WHERE snelstart_message_id IS NULL AND booked_at IS NULL;
CREATE INDEX IF NOT EXISTS finance_documents_duplicate_of_idx ON public.finance_documents (duplicate_of);
DROP INDEX IF EXISTS public.finance_expenses_supplier_name_idx;

CREATE OR REPLACE FUNCTION public.finance_expense_next_ref() RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT 'FIN-' || lpad(n::text, GREATEST(6, length(n::text)), '0')
  FROM nextval('public.finance_expense_ref_seq') AS n
$$;
ALTER TABLE public.finance_expenses ALTER COLUMN ref SET DEFAULT public.finance_expense_next_ref();
ALTER SEQUENCE public.finance_expense_ref_seq OWNED BY public.finance_expenses.ref;
