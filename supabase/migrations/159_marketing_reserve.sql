-- 159_marketing_reserve.sql
-- Beer, 2026-09-05: "er moet wel altijd 25% budget overblijven om in marketing
-- te investeren" — the monthly allocation cron must never put the entire
-- growth pot toward goals; a slice always stays free cash for marketing
-- spend decided by hand. Adjustable via a slider in Instellingen, not a
-- hardcoded constant, per "allow me to experiment tha[t] percentage".

ALTER TABLE public.finance_settings
  ADD COLUMN marketing_reserve_pct integer NOT NULL DEFAULT 25
    CHECK (marketing_reserve_pct BETWEEN 0 AND 100);

COMMENT ON COLUMN public.finance_settings.marketing_reserve_pct IS
  'planMonthlyAllocation (allocation.ts) never allocates more than (100 - this)% of availableForGrowthCents to owner-salary top-up + goals — the rest stays untouched free cash. 0 = no reserve, allocate everything.';
