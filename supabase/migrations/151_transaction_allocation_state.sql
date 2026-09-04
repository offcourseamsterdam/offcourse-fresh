-- 151_transaction_allocation_state.sql
-- Financial Management Module — Phase 3: remember what a transaction already did
-- to the plan, so re-classifying it can undo exactly that and no more.
--
-- Without this column a correction would double-count: the salary buffer would be
-- drawn down twice, or a goal would stay completed after the link was removed.

ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS allocation_applied jsonb,
  ADD COLUMN IF NOT EXISTS allocation_applied_at timestamptz;

COMMENT ON COLUMN public.bank_transactions.allocation_applied IS
  'The AllocationChange[] currently in force for this transaction. Reversed before a re-classification applies new ones. Null means the row has never touched the plan.';
