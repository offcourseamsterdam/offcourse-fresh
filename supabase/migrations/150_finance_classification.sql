-- 150_finance_classification.sql
-- Financial Management Module — Phase 3: transaction classification.
-- Plan: docs/plans/2026-09-04-financial-management-module.md §7
--
-- One table: the rules Beer builds up by correcting the AI. Everything else
-- Phase 3 needs already exists as columns on bank_transactions (migration 149).
--
-- RLS ON, zero policies = service-role only, like every other finance table.

CREATE TABLE public.finance_classification_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Which field of the transaction to match against.
  match_field text NOT NULL CHECK (match_field IN ('counterparty_name', 'merchant_name', 'description', 'reference')),
  -- Case-insensitive substring. Stored lowercased and trimmed by the API.
  pattern text NOT NULL CHECK (length(btrim(pattern)) >= 2),
  -- Only apply to money in / money out / either. A name like "Taste Vin" is a
  -- customer on the way in and a supplier on the way out, so direction matters.
  direction text NOT NULL DEFAULT 'any' CHECK (direction IN ('in', 'out', 'any')),
  category text NOT NULL,
  subcategory text,
  boat_id uuid REFERENCES public.boats(id) ON DELETE SET NULL,
  goal_id uuid REFERENCES public.finance_goals(id) ON DELETE SET NULL,
  -- Higher wins when several rules match. User rules default above the
  -- structural fallbacks; a hand-tuned rule can be pushed higher still.
  priority integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  -- Provenance: which correction taught us this, and how often it has fired.
  created_from_transaction_id uuid REFERENCES public.bank_transactions(id) ON DELETE SET NULL,
  hit_count integer NOT NULL DEFAULT 0,
  last_hit_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX finance_classification_rules_active_idx
  ON public.finance_classification_rules (priority DESC)
  WHERE is_active = true;

-- The same pattern on the same field and direction should exist once.
CREATE UNIQUE INDEX finance_classification_rules_unique_idx
  ON public.finance_classification_rules (match_field, lower(pattern), direction);

COMMENT ON TABLE public.finance_classification_rules IS
  'Learned classification rules. Created when a human corrects a transaction and ticks "remember this". Applied before the AI, so a correction is permanent and free.';

ALTER TABLE public.finance_classification_rules ENABLE ROW LEVEL SECURITY;

-- Lets the classifier find "did I already link this loan payment / obligation?"
-- and lets the transactions list filter the review queue quickly.
CREATE INDEX bank_transactions_unclassified_idx
  ON public.bank_transactions (created_at DESC)
  WHERE category IS NULL;
