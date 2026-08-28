-- 128: per-person control over whether the scheduler may Slack someone.
--
-- Being an active skipper and being someone the system should message are two
-- different facts, and until now they were the same column: any staff row with
-- a slack_member_id got DM'd the moment a shift was assigned to them. There
-- was no way to keep somebody on the roster while keeping the automation
-- quiet, short of deleting their Slack id (which also breaks the audit trail).
ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS slack_notifications_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.staff.slack_notifications_enabled IS
  'When false, automated scheduling messages are never sent to this person. They can still be assigned shifts — this governs messaging only.';
