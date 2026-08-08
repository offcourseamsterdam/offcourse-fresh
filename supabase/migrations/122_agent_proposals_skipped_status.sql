-- 122: agent_proposals needs a status for "the agent looked and consciously
-- decided not to act" (distinct from 'rejected', which is a human's call,
-- and distinct from simply never creating a row, which is what happens
-- today and is why that reasoning is currently invisible).
ALTER TABLE public.agent_proposals DROP CONSTRAINT IF EXISTS agent_proposals_status_check;

ALTER TABLE public.agent_proposals ADD CONSTRAINT agent_proposals_status_check
  CHECK (status IN ('shadow', 'proposed', 'approved', 'rejected', 'expired', 'booking', 'sending', 'executed', 'skipped'));
