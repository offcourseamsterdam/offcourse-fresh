-- 157_finance_investments.sql
-- Financial Management Module — Phase 5: the investment shortlist + what-if.
-- Plan: docs/plans/2026-09-04-financial-management-module.md §4, §9 (phase 5).
--
-- An investment is a candidate use of "beschikbaar voor groei" — an idea with a price
-- tag and a judgement about its impact, NOT an obligation. It never enters the cockpit
-- formula: nothing here is deducted from cash until it becomes a real goal or a real
-- payment. The scenario endpoint answers "what would the cockpit look like if I spent
-- this" by re-running the same computeCockpit with a lower cash figure.
--
-- RLS ON with zero policies = service-role only, same convention as 148.

CREATE TABLE public.finance_investments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  boat_id uuid REFERENCES public.boats(id) ON DELETE SET NULL,
  type text NOT NULL DEFAULT 'growth'
    CHECK (type IN ('growth', 'capacity', 'efficiency', 'maintenance', 'upgrade', 'risk', 'strategic')),
  -- {capacity, revenue, savings, reliability, lifespan, risk, urgency, confidence: 1..5, notes}
  -- A judgement, deliberately scored by hand — see the plan's "niet betrouwbaar te
  -- kwantificeren" note: a made-up euro return is worse than an honest ranking.
  impact jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- NULL means exactly that: the return could not be quantified honestly. Never 0 as a stand-in.
  expected_return_cents integer,
  status text NOT NULL DEFAULT 'idea'
    CHECK (status IN ('idea', 'planned', 'approved', 'executed', 'dropped')),
  executed_transaction_id uuid REFERENCES public.bank_transactions(id) ON DELETE SET NULL,
  goal_id uuid REFERENCES public.finance_goals(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.finance_investments IS 'Candidate uses of the growth room. Never deducted from cash by computeCockpit — becoming real means becoming a goal, an obligation or a payment.';
COMMENT ON COLUMN public.finance_investments.expected_return_cents IS 'NULL = not honestly quantifiable (plan §4). Never store 0 to mean "unknown".';
CREATE INDEX finance_investments_status_idx ON public.finance_investments (status);
ALTER TABLE public.finance_investments ENABLE ROW LEVEL SECURITY;
