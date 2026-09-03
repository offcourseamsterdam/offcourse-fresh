-- 147_fixed_cost_items.sql
-- Itemized vaste kosten (zoals telefoonabonnement, software, verzekering)

ALTER TABLE public.finance_budget_settings
  ADD COLUMN IF NOT EXISTS fixed_cost_items jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.finance_budget_settings.fixed_cost_items IS 'Array van itemized vaste kosten: [{ id, name, monthly_cents }]';
