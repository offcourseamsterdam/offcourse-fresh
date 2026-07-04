-- 076: allow the 'booking' status on agent_proposals.
--
-- The inbox Ghost co-pilot's "Approve & create booking" action atomically
-- claims a proposal by flipping its status 'shadow' → 'booking' BEFORE calling
-- the FareHarbor money path, then → 'executed' on success (or back to 'shadow'
-- on failure, so the human can retry). See the `book` action in
-- src/app/api/admin/ghost/proposals/[id]/route.ts.
--
-- Migration 071 created the status CHECK without 'booking', so every approve
-- click would violate the constraint and 500 before reaching FareHarbor. This
-- adds the transient claim state. Purely additive — no existing row changes.

ALTER TABLE public.agent_proposals DROP CONSTRAINT IF EXISTS agent_proposals_status_check;

ALTER TABLE public.agent_proposals ADD CONSTRAINT agent_proposals_status_check
  CHECK (status IN ('shadow', 'proposed', 'approved', 'rejected', 'expired', 'booking', 'executed'));
