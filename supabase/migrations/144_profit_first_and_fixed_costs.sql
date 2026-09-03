-- 144_profit_first_and_fixed_costs.sql
-- Add Profit First allocations and fixed costs (liggeld, owner salary) to budget settings

ALTER TABLE public.finance_budget_settings
  ADD COLUMN IF NOT EXISTS profit_first_profit_pct numeric NOT NULL DEFAULT 5.0,
  ADD COLUMN IF NOT EXISTS owner_salary_monthly_cents integer NOT NULL DEFAULT 350000,
  ADD COLUMN IF NOT EXISTS owner_salary_pct numeric NOT NULL DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS boat_count integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS berth_fee_per_boat_yearly_cents integer NOT NULL DEFAULT 400000,
  ADD COLUMN IF NOT EXISTS other_fixed_costs_monthly_cents integer NOT NULL DEFAULT 120000,
  ADD COLUMN IF NOT EXISTS zettle_cogs_pct numeric NOT NULL DEFAULT 28.0;

COMMENT ON COLUMN public.finance_budget_settings.profit_first_profit_pct IS 'Profit First: percentage van omzet direct naar Winstpot (bv 5% of 10%)';
COMMENT ON COLUMN public.finance_budget_settings.owner_salary_monthly_cents IS 'Profit First: vast maandsalaris voor eigenaar (bv 350000 = € 3.500)';
COMMENT ON COLUMN public.finance_budget_settings.berth_fee_per_boat_yearly_cents IS 'Liggeld per boot per jaar in centen ex BTW (bv 400000 = € 4.000)';
