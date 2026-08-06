-- WhatsApp's 24h customer-service window: every inbound message from the
-- customer reopens a 24h free-form reply window; outside it, only approved
-- templates work. Tracked per-conversation so the inbox can show "Xh left to
-- reply" instead of only finding out when a send fails with Twilio error
-- 63016. See docs/plans/unified-inbox-and-comms.md §6 and
-- docs/features/whatsapp-twilio-integration.md.
ALTER TABLE public.conversations
  ADD COLUMN wa_window_expires_at timestamptz NULL;
