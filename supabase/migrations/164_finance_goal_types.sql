-- Migration 164: Support goal types (Target, Sinking Fund / Maintenance, Monthly Refill / Operations)
ALTER TABLE public.finance_goals
ADD COLUMN IF NOT EXISTS goal_type text NOT NULL DEFAULT 'target'
CHECK (goal_type IN ('target', 'sinking_fund', 'monthly_refill'));

COMMENT ON COLUMN public.finance_goals.goal_type IS 'Goal type: target (standard purchase/savings target), sinking_fund (maintenance/accrual capped at target), or monthly_refill (YNAB needed for spending / operations fund refilled to target monthly).';
