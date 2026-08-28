-- Fixes a real bug found 2026-08-21: two DIFFERENT FareHarbor booking
-- notifications (Princess Vongchanh's #373039538 and Victoria Kingdom's
-- #373155286 — same date/time slot, so an identical subject line) got
-- threaded together by Gmail itself under one native threadId. gmail/sync.ts
-- already intends to group OTA notifications by (ota_source, ota_booking_ref)
-- instead of Gmail's threadId (see its findOrCreateConversation), but the
-- OLD conversations_thread_id_unique_idx (migration 118) only knows about
-- provider_thread_id — so inserting Victoria's new conversation hit that
-- constraint, was treated as a same-thread race, and got silently merged
-- into Princess's unrelated conversation instead of creating its own.
--
-- The real uniqueness key for an OTA notification conversation is
-- (ota_source, ota_booking_ref), not provider_thread_id — Gmail's threadId
-- is just where the notification happened to land, not what identifies the
-- booking. Two different booking refs must be allowed to share a thread id;
-- two notifications for the SAME booking ref must still collide (the
-- original TOCTOU race protection this whole mechanism exists for).

DROP INDEX IF EXISTS conversations_thread_id_unique_idx;

-- Normal (non-OTA) email conversations: unchanged behavior, just scoped to
-- rows with no booking ref so it no longer overlaps the OTA index below.
CREATE UNIQUE INDEX conversations_thread_id_unique_idx
  ON public.conversations (provider_thread_id)
  WHERE channel = 'email' AND provider_thread_id IS NOT NULL AND ota_booking_ref IS NULL;

-- OTA notification conversations: unique per (platform, booking ref),
-- independent of whatever Gmail thread they land on.
CREATE UNIQUE INDEX conversations_ota_ref_unique_idx
  ON public.conversations (ota_source, ota_booking_ref)
  WHERE channel = 'email' AND ota_booking_ref IS NOT NULL;
