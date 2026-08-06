-- One-line AI (Haiku) summary of the latest inbound message, shown in the
-- inbox list instead of the raw email body — real emails (especially OTA
-- notifications) are full of marketing boilerplate/tracking links that make
-- a raw-body snippet useless at a glance. Set by lib/gmail/summarize.ts.
-- Null falls back to the raw snippet in the UI (summary generation is
-- best-effort and never blocks ingestion).
ALTER TABLE public.conversations
  ADD COLUMN ai_summary text NULL;
