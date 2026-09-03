-- 146_multi_loans_and_scenario_planning.sql
-- Support multiple loans array and scenario planning (marketing slider, ALF categories)

ALTER TABLE public.finance_budget_settings
  ADD COLUMN IF NOT EXISTS loans jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS alf_categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS marketing_scenario_spend_cents integer NOT NULL DEFAULT 200000;

COMMENT ON COLUMN public.finance_budget_settings.loans IS 'Array van leningen: [{ id, name, principal_total_cents, monthly_principal_cents, monthly_interest_cents, interest_rate_pct, target_payoff_year }]';
COMMENT ON COLUMN public.finance_budget_settings.alf_categories IS 'Array van ALF categorieën met toggles: [{ id, name, active, fee_cents }]';
COMMENT ON COLUMN public.finance_budget_settings.marketing_scenario_spend_cents IS 'What-if marketing maandbudget in centen (bv 200000 of 400000)';
