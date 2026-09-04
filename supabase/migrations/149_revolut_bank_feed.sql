-- 149_revolut_bank_feed.sql
-- Financial Management Module — Phase 2: Revolut Business API feed.
-- Plan: docs/plans/2026-09-04-financial-management-module.md §3, §4, §7
--
-- All tables: RLS ON, zero policies (service-role only). Secrets are stored
-- encrypted (AES-256-GCM, src/lib/revolut/crypto.ts) — never in plain text.

-- ── 1. The single Revolut connection ─────────────────────────────────────────
CREATE TABLE public.revolut_connection (
  id text PRIMARY KEY DEFAULT 'default',
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
  client_id text,
  redirect_uri text,
  scopes text[] NOT NULL DEFAULT '{}',
  refresh_token_enc text,
  access_token_enc text,
  access_token_expires_at timestamptz,
  -- Set while a refresh is in flight so concurrent lambdas don't invalidate each other's token.
  refresh_lock_until timestamptz,
  consented_at timestamptz,
  -- The EUR account whose balance is "cash". Chosen in the admin after consent.
  account_id text,
  account_name text,
  webhook_id text,
  webhook_url text,
  webhook_secret_enc text,
  last_sync_at timestamptz,
  last_sync_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.revolut_connection IS 'Single-row Revolut Business API connection. Tokens encrypted with REVOLUT_TOKEN_KEY. Refresh invalidates the previous access token, so this row is the ONLY token store.';
ALTER TABLE public.revolut_connection ENABLE ROW LEVEL SECURITY;
INSERT INTO public.revolut_connection (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

-- ── 2. Balance snapshots (cleared cash over time) ────────────────────────────
CREATE TABLE public.revolut_balance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taken_at timestamptz NOT NULL DEFAULT now(),
  account_id text NOT NULL,
  balance_cents integer NOT NULL,
  currency text NOT NULL DEFAULT 'EUR',
  source text NOT NULL DEFAULT 'sync' CHECK (source IN ('sync', 'webhook', 'manual'))
);
CREATE INDEX revolut_balance_snapshots_taken_idx ON public.revolut_balance_snapshots (account_id, taken_at DESC);
ALTER TABLE public.revolut_balance_snapshots ENABLE ROW LEVEL SECURITY;

-- ── 3. Bank transactions (the feed) ──────────────────────────────────────────
-- Distinct from revolut_transactions (merchant/payment-link statement rows used
-- for VAT bookkeeping). One row per Revolut transaction, our EUR leg.
CREATE TABLE public.bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revolut_id text NOT NULL UNIQUE,
  request_id text,
  type text NOT NULL,                           -- card_payment, transfer, fee, topup, refund, exchange, tax, ...
  state text NOT NULL,                          -- created, pending, completed, declined, failed, reverted
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  account_id text NOT NULL,
  amount_cents integer NOT NULL,                -- signed: negative = money out
  fee_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EUR',
  balance_after_cents integer,                  -- leg.balance when Revolut provides it
  reference text,
  description text,
  counterparty jsonb,
  merchant jsonb,
  raw jsonb NOT NULL,
  -- Classification (Phase 3). Nullable until classified.
  category text,
  subcategory text,
  boat_id uuid REFERENCES public.boats(id) ON DELETE SET NULL,
  goal_id uuid REFERENCES public.finance_goals(id) ON DELETE SET NULL,
  obligation_id uuid REFERENCES public.finance_obligations(id) ON DELETE SET NULL,
  loan_payment_id uuid REFERENCES public.finance_loan_payments(id) ON DELETE SET NULL,
  invoice_id uuid,
  classified_by text CHECK (classified_by IN ('rule', 'ai', 'user')),
  confidence numeric(4,3),
  classification_reason text,
  needs_review boolean NOT NULL DEFAULT false,
  reviewed_at timestamptz,
  vat_cents integer,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bank_transactions_created_idx ON public.bank_transactions (created_at DESC);
CREATE INDEX bank_transactions_state_idx ON public.bank_transactions (state) WHERE state IN ('created', 'pending');
CREATE INDEX bank_transactions_review_idx ON public.bank_transactions (needs_review) WHERE needs_review = true;
ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;

-- ── 4. Webhook receipts (idempotency + audit) ────────────────────────────────
CREATE TABLE public.revolut_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key text NOT NULL UNIQUE,              -- event + transaction id + Revolut-Request-Timestamp
  event_type text NOT NULL,
  transaction_id text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error text,
  payload jsonb NOT NULL
);
ALTER TABLE public.revolut_webhook_events ENABLE ROW LEVEL SECURITY;
