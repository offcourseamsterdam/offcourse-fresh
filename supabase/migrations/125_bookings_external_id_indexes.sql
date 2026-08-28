-- The FareHarbor webhook's pk-fallback lookup (supabase/functions/fareharbor-webhook/index.ts)
-- queries bookings.external_id and bookings.booking_id on every webhook delivery for
-- OTA-imported and newly-external bookings (booking_uuid isn't known yet for those) —
-- this is not a rare path. Without an index, that's a full table scan on every such
-- delivery for a webhook that fires on every live FareHarbor event. Also indexes
-- booking_uuid, used by the webhook's primary (pre-existing) match.
CREATE INDEX IF NOT EXISTS idx_bookings_external_id ON public.bookings (external_id);
CREATE INDEX IF NOT EXISTS idx_bookings_booking_id ON public.bookings (booking_id);
CREATE INDEX IF NOT EXISTS idx_bookings_booking_uuid ON public.bookings (booking_uuid);
