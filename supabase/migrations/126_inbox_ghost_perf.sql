-- 126: Perf fixes for the admin Inbox and Ghost/AI Ops pages, found during a
-- code review pass (see git log for the corresponding app-code changes).

-- Inbox: matching a contact to their booking history filters bookings by
-- customer_email/customer_phone. No index existed on either column, so this
-- ran as a full table scan on every inbox thread open + every inbox list
-- poll (10s).
CREATE INDEX IF NOT EXISTS idx_bookings_customer_email ON public.bookings (customer_email);
CREATE INDEX IF NOT EXISTS idx_bookings_customer_phone ON public.bookings (customer_phone);

-- Ghost page: the "open questions" panel filters agent_proposals by a JSONB
-- path with no supporting index — a growing sequential scan on every 15s
-- poll of /admin/ghost.
CREATE INDEX IF NOT EXISTS agent_proposals_open_question_idx
  ON public.agent_proposals ((payload ->> 'open_question'))
  WHERE payload ->> 'open_question' IS NOT NULL;

-- Ghost's AI spend gauge: recordAiUsage() (after every single AI call) and
-- getAiSpendSummary() (the /admin/ghost 15s poll) both used to pull every
-- row of ai_usage over the wire and sum it in JS — the same unbounded-egress
-- shape as the June 2026 incident (see ghost_stats() in 075 for the same
-- "aggregate in SQL, not app code" fix, applied here to ai_usage).
CREATE OR REPLACE FUNCTION public.ai_usage_total_cents()
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(sum(cost_eur_cents), 0) FROM public.ai_usage;
$$;

CREATE OR REPLACE FUNCTION public.ai_spend_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'totalCents',   coalesce((SELECT sum(cost_eur_cents) FROM public.ai_usage), 0),
    'last30dCents', coalesce((SELECT sum(cost_eur_cents) FROM public.ai_usage WHERE created_at >= now() - interval '30 days'), 0),
    'calls',        (SELECT count(*) FROM public.ai_usage),
    'byFeature',    coalesce(
                       (SELECT jsonb_agg(jsonb_build_object('feature', feature, 'totalCents', cents, 'calls', calls) ORDER BY cents DESC)
                        FROM (
                          SELECT feature, sum(cost_eur_cents) AS cents, count(*) AS calls
                          FROM public.ai_usage
                          GROUP BY feature
                        ) f),
                       '[]'::jsonb
                     )
  );
$$;
