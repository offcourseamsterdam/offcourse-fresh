-- Splits "captain assigned" from "captain told" for auto-scheduled shifts.
-- The proactive scheduler (autonomy 'auto') now assigns a shift immediately
-- but withholds the Slack DM until Beer explicitly confirms — assignments
-- made far ahead of the date are provisional as more bookings come in, and a
-- captain shouldn't be pinged, then re-pinged, every time the roster shifts.
-- NULL = assigned but not yet notified; a timestamp = the DM actually went out.
ALTER TABLE public.shifts ADD COLUMN notified_at timestamptz NULL;
