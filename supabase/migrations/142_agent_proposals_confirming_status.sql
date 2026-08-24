-- 142: add 'confirming' to agent_proposals.status (Beer, 2026-08-24: the
-- upsell-bonus "review environment" needs its own atomic-claim intermediate,
-- same reasoning as the existing 'booking'/'sending' claims — 'confirming'
-- (not straight to 'executed') so a crash between the claim and the real
-- extra_hours_bonuses insert is visibly stuck, not silently indistinguishable
-- from a genuine success.

ALTER TABLE public.agent_proposals DROP CONSTRAINT agent_proposals_status_check;
ALTER TABLE public.agent_proposals ADD CONSTRAINT agent_proposals_status_check
  CHECK (status IN ('shadow', 'proposed', 'approved', 'rejected', 'expired', 'booking', 'sending', 'confirming', 'executed', 'skipped'));
