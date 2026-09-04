-- 148_finance_core.sql
-- Financial Management Module — Phase 0 foundations.
-- Plan: docs/plans/2026-09-04-financial-management-module.md
--
-- 1. Remove the Profit-First experiment (percentage pots) that migrations 143–147 created.
-- 2. Create the planning tables the cash cockpit computes from.
--
-- All new tables: RLS ON with zero policies = service-role only. Every write goes through
-- /api/admin/finance/cockpit/* routes; nothing here is readable by anon or authenticated roles.

-- ── 1. Drop the experiment ────────────────────────────────────────────────────
DROP TABLE IF EXISTS public.finance_budget_settings;
ALTER TABLE public.extras DROP COLUMN IF EXISTS cost_price_value;

-- ── 2. Settings (single row) ─────────────────────────────────────────────────
CREATE TABLE public.finance_settings (
  id text PRIMARY KEY DEFAULT 'default',
  planning_horizon text NOT NULL DEFAULT '3m' CHECK (planning_horizon IN ('30d', '3m', '12m')),
  safety_margin_cents integer NOT NULL DEFAULT 2000000,
  operational_coverage_cents integer NOT NULL DEFAULT 0,
  owner_salary_monthly_cents integer NOT NULL DEFAULT 0,
  owner_salary_months integer NOT NULL DEFAULT 3 CHECK (owner_salary_months IN (1, 2, 3, 4, 6)),
  owner_salary_coverage_cents integer NOT NULL DEFAULT 0,
  -- Only used while Revolut is not connected. The UI labels it "handmatig ingevoerd op <date>".
  manual_cash_cents integer,
  manual_cash_at timestamptz,
  allocation_priority jsonb NOT NULL DEFAULT '["obligations","operational","owner_salary","goals"]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.finance_settings IS 'Cash cockpit configuration. Single row id=default. Amounts in cents.';
COMMENT ON COLUMN public.finance_settings.owner_salary_coverage_cents IS 'Stored owner-salary buffer. Decreases when a salary transaction is classified, refilled by the monthly allocation cron. Target = monthly × months.';
COMMENT ON COLUMN public.finance_settings.safety_margin_cents IS 'Threshold, not a reserve: beschikbaar voor groei = financiële ruimte − this.';
ALTER TABLE public.finance_settings ENABLE ROW LEVEL SECURITY;
INSERT INTO public.finance_settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

-- ── 3. Loans + materialised repayment schedule ───────────────────────────────
CREATE TABLE public.finance_loans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  lender_name text NOT NULL,
  principal_cents integer NOT NULL CHECK (principal_cents > 0),
  interest_rate_pct numeric(6,3) NOT NULL DEFAULT 0,
  duration_years integer NOT NULL CHECK (duration_years > 0),
  interest_free_years integer NOT NULL DEFAULT 0 CHECK (interest_free_years >= 0),
  repayment_type text NOT NULL DEFAULT 'linear' CHECK (repayment_type IN ('linear', 'annuity', 'interest_only')),
  start_date date NOT NULL,
  -- Optional staggered disbursement: [{ "amount_cents": 1000000, "date": "2025-09-25", "note": "" }]
  tranches jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.finance_loans IS 'Investor/bank loans. Schedule is derived by src/lib/finance/cockpit/loans/schedule.ts and materialised into finance_loan_payments.';
ALTER TABLE public.finance_loans ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.finance_loan_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id uuid NOT NULL REFERENCES public.finance_loans(id) ON DELETE CASCADE,
  due_date date NOT NULL,
  interest_cents integer NOT NULL DEFAULT 0,
  principal_cents integer NOT NULL DEFAULT 0,
  total_cents integer NOT NULL DEFAULT 0,
  is_paid boolean NOT NULL DEFAULT false,
  paid_at timestamptz,
  paid_transaction_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (loan_id, due_date)
);
CREATE INDEX finance_loan_payments_due_idx ON public.finance_loan_payments (due_date) WHERE is_paid = false;
ALTER TABLE public.finance_loan_payments ENABLE ROW LEVEL SECURITY;

-- ── 4. Obligations (dated, horizon-scoped deductions) ────────────────────────
CREATE TABLE public.finance_obligations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('tax', 'loan', 'insurance', 'berth', 'salary', 'contract', 'invoice', 'other')),
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  due_date date NOT NULL,
  -- Recurring obligations are expanded at compute time within the horizon; never materialised.
  recurrence_months integer CHECK (recurrence_months IN (1, 3, 6, 12)),
  recurrence_until date,
  boat_id uuid REFERENCES public.boats(id) ON DELETE SET NULL,
  loan_id uuid REFERENCES public.finance_loans(id) ON DELETE CASCADE,
  invoice_id uuid,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid', 'cancelled')),
  paid_transaction_id uuid,
  paid_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX finance_obligations_open_due_idx ON public.finance_obligations (due_date) WHERE status = 'open';
ALTER TABLE public.finance_obligations ENABLE ROW LEVEL SECURITY;

-- ── 5. Goals (stored planning reserves) ──────────────────────────────────────
CREATE TABLE public.finance_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  target_cents integer NOT NULL CHECK (target_cents > 0),
  funded_cents integer NOT NULL DEFAULT 0 CHECK (funded_cents >= 0),
  deadline date,
  priority integer NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
  monthly_funding_cents integer NOT NULL DEFAULT 0 CHECK (monthly_funding_cents >= 0),
  boat_id uuid REFERENCES public.boats(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused')),
  flexibility text NOT NULL DEFAULT 'flexible' CHECK (flexibility IN ('fixed', 'flexible')),
  completed_transaction_id uuid,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN public.finance_goals.funded_cents IS 'Planning reserve, NOT a bank balance. Changed only by user edit, monthly allocation cron, or a linked purchase.';
ALTER TABLE public.finance_goals ENABLE ROW LEVEL SECURITY;

-- ── 6. Audit log for every planning change ───────────────────────────────────
CREATE TABLE public.finance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL,
  actor text NOT NULL CHECK (actor IN ('user', 'cron', 'ai', 'webhook', 'system')),
  entity_type text NOT NULL,
  entity_id uuid,
  delta_cents integer,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX finance_events_entity_idx ON public.finance_events (entity_type, entity_id, occurred_at DESC);
ALTER TABLE public.finance_events ENABLE ROW LEVEL SECURITY;
