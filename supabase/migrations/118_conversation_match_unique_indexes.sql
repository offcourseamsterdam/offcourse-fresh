-- Backs the select-then-insert matching in twilio/inbox-match.ts and
-- gmail/sync.ts with a real DB guarantee, closing a TOCTOU race: two
-- near-simultaneous webhook deliveries (Twilio retries a slow/non-2xx
-- response, or an inbound message races an admin outbound action) could both
-- SELECT before either INSERT commits, splitting one contact's history across
-- two conversation rows. The application code now catches the resulting
-- 23505 and re-fetches the winning row instead of creating a duplicate.

CREATE UNIQUE INDEX conversations_contact_channel_unique_idx
  ON public.conversations (contact_id, channel)
  WHERE channel IN ('whatsapp', 'voice');

CREATE UNIQUE INDEX conversations_thread_id_unique_idx
  ON public.conversations (provider_thread_id)
  WHERE channel = 'email' AND provider_thread_id IS NOT NULL;
