-- The admin inbox list route (polled every 10s by every open admin tab)
-- filters bookings by catering_thread_id to flag supplier-reply threads.
-- Without an index this forces a full sequential scan of a core, growing
-- money-path table on every poll. Partial index (mirrors the pattern in
-- 112_ota_conversations.sql) since most bookings never have this set.
CREATE INDEX bookings_catering_thread_id_idx
  ON public.bookings (catering_thread_id)
  WHERE catering_thread_id IS NOT NULL;
