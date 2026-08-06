-- Lets the inbox sidebar show a checkmark (booking confirmed, ready to
-- create) vs a clock (new request, still just an availability check) for OTA
-- conversations at a glance, without joining agent_proposals on every list
-- poll. Set by lib/ota/handle-message.ts alongside the proposal it writes.
ALTER TABLE public.conversations
  ADD COLUMN ota_status text NULL;
