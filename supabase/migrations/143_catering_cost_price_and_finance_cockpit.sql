-- 143_catering_cost_price_and_finance_cockpit.sql
-- Inkoopprijzen voor catering en dynamische budget-instellingen voor de Winst & Cash Cockpit

-- 1. Inkoopprijs op de extras tabel
ALTER TABLE public.extras
  ADD COLUMN IF NOT EXISTS cost_price_value integer DEFAULT 0;

COMMENT ON COLUMN public.extras.cost_price_value IS 'Inkoopkosten (COGS) in centen per eenheid (bijv. 3250 = € 32,50)';

-- 2. Initieer reële inschattingen voor bestaande catering items
UPDATE public.extras SET cost_price_value = 3250 WHERE name = 'Bites Box Large (6 guests)' AND (cost_price_value IS NULL OR cost_price_value = 0);
UPDATE public.extras SET cost_price_value = 1750 WHERE name = 'Bites Box Medium (3-4 guests)' AND (cost_price_value IS NULL OR cost_price_value = 0);
UPDATE public.extras SET cost_price_value = 1000 WHERE name = 'Bites Box Small (1-2 guests)' AND (cost_price_value IS NULL OR cost_price_value = 0);
UPDATE public.extras SET cost_price_value = 850 WHERE name = 'Jamaican Curry Chicken' AND (cost_price_value IS NULL OR cost_price_value = 0);
UPDATE public.extras SET cost_price_value = 1000 WHERE name = 'Jamaican Curry Goat' AND (cost_price_value IS NULL OR cost_price_value = 0);
UPDATE public.extras SET cost_price_value = 1000 WHERE name = 'Jamaican Oxtail Stew' AND (cost_price_value IS NULL OR cost_price_value = 0);
UPDATE public.extras SET cost_price_value = 1450 WHERE name = 'Jamaican Buffet' AND (cost_price_value IS NULL OR cost_price_value = 0);
UPDATE public.extras SET cost_price_value = 750 WHERE name = 'Jamaican Peppered Prawns' AND (cost_price_value IS NULL OR cost_price_value = 0);
UPDATE public.extras SET cost_price_value = 450 WHERE name = 'Cheese Platter' AND (cost_price_value IS NULL OR cost_price_value = 0);
UPDATE public.extras SET cost_price_value = 550 WHERE name = 'Charcuterie Platter' AND (cost_price_value IS NULL OR cost_price_value = 0);
UPDATE public.extras SET cost_price_value = 550 WHERE name = 'Fruit Platter' AND (cost_price_value IS NULL OR cost_price_value = 0);
UPDATE public.extras SET cost_price_value = 2200 WHERE name = 'Brunch' AND (cost_price_value IS NULL OR cost_price_value = 0);
UPDATE public.extras SET cost_price_value = 350 WHERE name = 'Unlimited Drinks' AND (cost_price_value IS NULL OR cost_price_value = 0);

-- 3. Budget Settings Tabel voor dynamische potjes
CREATE TABLE IF NOT EXISTS public.finance_budget_settings (
  id text PRIMARY KEY DEFAULT 'default',
  maintenance_pct numeric NOT NULL DEFAULT 8.0,
  marketing_pct numeric NOT NULL DEFAULT 6.0,
  fixed_costs_monthly_cents integer NOT NULL DEFAULT 200000,
  winter_buffer_target_cents integer NOT NULL DEFAULT 2500000,
  default_monthly_revenue_target_cents integer NOT NULL DEFAULT 4000000,
  target_skipper_ratio_pct numeric NOT NULL DEFAULT 18.0,
  target_catering_margin_pct numeric NOT NULL DEFAULT 55.0,
  default_skipper_hourly_rate_cents integer NOT NULL DEFAULT 3500,
  revolut_manual_balance_cents integer NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.finance_budget_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "finance_budget_settings_service_all"
  ON public.finance_budget_settings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

INSERT INTO public.finance_budget_settings (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;
