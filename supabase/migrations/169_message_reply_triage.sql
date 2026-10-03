-- 169_message_reply_triage.sql
-- The inbox reply doorman (src/lib/gmail/reply-triage.ts): per inbound email, does someone
-- at Off Course need to write back? Stored on the message itself so every verdict can later
-- be compared with whether we actually replied. A label only — nothing is hidden or skipped
-- because of it. Nullable and additive: existing rows and every non-email channel stay null.
-- Existing table, so its RLS (on, no anon access) already covers the new column.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_triage jsonb;

COMMENT ON COLUMN public.messages.reply_triage IS
  'Reply doorman verdict for a plain inbound email: {v, verdict: yes|no|maybe, source, signals[], ai_verdict, ai_reason, at}. Null = not judged (outbound, non-email, OTA/finance/catering/review mail, or ingested before 2026-10-03).';
