-- 075: Ghost review surface — a reviewed flag + a true-count stats RPC.

-- Triage state: has a human looked at this proposal yet?
ALTER TABLE public.agent_proposals ADD COLUMN IF NOT EXISTS reviewed_at timestamptz NULL;
CREATE INDEX IF NOT EXISTS agent_proposals_reviewed_idx ON public.agent_proposals (reviewed_at);

-- One round-trip, true counts across the WHOLE table (the page used to compute
-- stats over only the latest 50 rows, so they silently capped). SECURITY DEFINER
-- is unnecessary — only the service role calls it.
CREATE OR REPLACE FUNCTION public.ghost_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'total',              (SELECT count(*) FROM public.agent_proposals),
    'reviewed',           (SELECT count(*) FROM public.agent_proposals WHERE reviewed_at IS NOT NULL),
    'corrected',          (SELECT count(*) FROM public.agent_proposals WHERE outcome IS NOT NULL AND kind IN ('reply_draft','booking_proposal')),
    'awaitingComparison', (SELECT count(*) FROM public.agent_proposals WHERE outcome IS NULL AND kind IN ('reply_draft','booking_proposal')),
    'byKind',             (SELECT coalesce(jsonb_object_agg(kind, c), '{}'::jsonb)
                             FROM (SELECT kind, count(*) AS c FROM public.agent_proposals GROUP BY kind) k),
    'knowledgeEntries',   (SELECT count(*) FROM public.ghost_knowledge)
  );
$$;
