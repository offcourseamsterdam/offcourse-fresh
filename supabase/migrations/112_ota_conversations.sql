-- OTA notification emails (Withlocals, GetMyBoat, ...) are not a chat with
-- the sender address itself — that's the platform's own relay, never the
-- guest. Multiple separate Gmail threads about the SAME booking (a request,
-- then later a confirmation) need to collapse into ONE conversation, keyed
-- by (ota_source, ota_booking_ref) instead of Gmail's per-thread grouping.
-- See docs/features/ota-notifications.md.
ALTER TABLE public.conversations
  ADD COLUMN ota_source text NULL,
  ADD COLUMN ota_booking_ref text NULL;

CREATE INDEX conversations_ota_lookup_idx
  ON public.conversations (ota_source, ota_booking_ref)
  WHERE ota_booking_ref IS NOT NULL;
