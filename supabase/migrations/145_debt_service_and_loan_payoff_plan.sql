-- 145_debt_service_and_loan_payoff_plan.sql
-- Add loan debt service (interest + principal repayment) and payoff tracking to budget settings

ALTER TABLE public.finance_budget_settings
  ADD COLUMN IF NOT EXISTS loan_name text NOT NULL DEFAULT 'Bootfinanciering',
  ADD COLUMN IF NOT EXISTS loan_principal_total_cents integer NOT NULL DEFAULT 4000000,
  ADD COLUMN IF NOT EXISTS loan_monthly_principal_cents integer NOT NULL DEFAULT 75000,
  ADD COLUMN IF NOT EXISTS loan_monthly_interest_cents integer NOT NULL DEFAULT 17500,
  ADD COLUMN IF NOT EXISTS loan_interest_rate_pct numeric NOT NULL DEFAULT 5.5,
  ADD COLUMN IF NOT EXISTS loan_target_payoff_year integer NOT NULL DEFAULT 2028;

COMMENT ON COLUMN public.finance_budget_settings.loan_principal_total_cents IS 'Totale resterende hoofdsom van lening in centen (bv 4000000 = € 40.000)';
COMMENT ON COLUMN public.finance_budget_settings.loan_monthly_principal_cents IS 'Maandelijkse aflossing in centen (bv 75000 = € 750 / mnd)';
COMMENT ON COLUMN public.finance_budget_settings.loan_monthly_interest_cents IS 'Maandelijkse rentelasten in centen (bv 17500 = € 175 / mnd)';
