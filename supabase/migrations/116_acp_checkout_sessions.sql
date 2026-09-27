-- Migration 116: ACP (Agentic Commerce Protocol) checkout sessions
--
-- Backs the Checkout Sessions API (src/app/api/acp/checkout_sessions) that
-- lets an AI agent complete a real cruise booking via a Stripe Shared
-- Payment Token. Must be a real table, not an in-memory store: create,
-- update, and complete can each land on a different serverless instance.
--
-- No public policies — this holds buyer PII (name/email/phone) and the
-- Stripe PaymentIntent linkage. All access goes through service-role API
-- routes, same as the bookings table itself.

CREATE TABLE IF NOT EXISTS public.acp_checkout_sessions (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'not_ready_for_payment',
  slug TEXT NOT NULL,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  avail_pk BIGINT,
  line_items JSONB NOT NULL DEFAULT '[]'::JSONB,
  currency TEXT NOT NULL DEFAULT 'eur',
  total_cents INTEGER,
  buyer JSONB,
  payment_intent_id TEXT UNIQUE,
  booking_id TEXT,
  messages JSONB NOT NULL DEFAULT '[]'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 minutes')
);

ALTER TABLE public.acp_checkout_sessions ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only (bypasses RLS), same posture as `bookings`.

COMMENT ON TABLE public.acp_checkout_sessions IS
  'Agentic Commerce Protocol checkout sessions — one row per create/update/complete lifecycle for an AI-agent-initiated cruise booking.';
