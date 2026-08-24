-- 140: allow an availability hours window to cross midnight (Beer,
-- 2026-08-24: "window crossing midnight... it's just like 12:30 or
-- something" — a late cruise ending shortly after midnight, not a full
-- overnight shift, but real enough that captains need to log it).
--
-- The old constraint required end_time > start_time, which rejected e.g.
-- start=22:00, end=00:30. The app layer (shiftFitsAvailabilityWindow in
-- src/lib/scheduling/availability-status.ts) now reads end <= start as
-- "wraps to the next day" — the only genuinely invalid case left is an
-- exactly-zero-length window (start == end), which means nothing under
-- either reading.

ALTER TABLE public.staff_availability DROP CONSTRAINT staff_availability_time_range_valid;
ALTER TABLE public.staff_availability ADD CONSTRAINT staff_availability_time_range_valid
  CHECK (
    (start_time IS NULL AND end_time IS NULL)
    OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time <> start_time)
  );
