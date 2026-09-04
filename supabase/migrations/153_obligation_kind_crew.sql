-- 153_obligation_kind_crew.sql
-- Derived skipper-hours accruals need their own obligation kind, so
-- "Komende verplichtingen" can show them as crew cost rather than "other".

ALTER TABLE public.finance_obligations DROP CONSTRAINT finance_obligations_kind_check;
ALTER TABLE public.finance_obligations
  ADD CONSTRAINT finance_obligations_kind_check
  CHECK (kind IN ('tax', 'loan', 'insurance', 'berth', 'salary', 'crew', 'contract', 'invoice', 'other'));
