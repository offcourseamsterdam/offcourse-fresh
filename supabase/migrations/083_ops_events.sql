-- ops_events — the AI Operations Engine's append-only event log.
--
-- Distinct from admin_event_log (a human-readable ops/audit feed, prunable,
-- severity-driven) and from agent_proposals (one row per AI recommendation).
-- ops_events is the raw substrate future scoring/forecasting will train on:
-- every operational transition, forever, queryable per entity. Coverage is
-- everything here is worth: see docs/features/ai-operations-engine.md.
--
-- Append-only is enforced at the database, not just by convention: no
-- UPDATE/DELETE policy exists (RLS ON, zero policies = service-role only,
-- and the service role has no reason to ever update or delete a row).

CREATE TABLE public.ops_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL CHECK (event_type IN (
    'booking_created',
    'booking_paid',
    'booking_confirmed',
    'booking_cancelled',
    'booking_fh_failed',
    'booking_fh_recovered',
    'shift_assigned',
    'shift_unassigned',
    'recommendation_created',
    'recommendation_reviewed',
    'recommendation_approved',
    'recommendation_rejected'
  )),
  actor_type text NOT NULL CHECK (actor_type IN ('human', 'agent', 'system')),
  actor_id text,                    -- admin email / agent key ('ops_optimizer') / cron name
  booking_id uuid,
  shift_id uuid,
  staff_id uuid,
  proposal_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL,             -- code path that emitted, e.g. 'webhooks/stripe'
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ops_events_type_time_idx ON public.ops_events (event_type, occurred_at DESC);
CREATE INDEX ops_events_booking_idx ON public.ops_events (booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX ops_events_occurred_idx ON public.ops_events (occurred_at);

ALTER TABLE public.ops_events ENABLE ROW LEVEL SECURITY;
