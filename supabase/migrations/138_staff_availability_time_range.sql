-- 138: optional time-of-day window on a captain's availability (Beer,
-- 2026-08-23: "it should be possible to say I am available between these
-- and these times"). NULL on both means "all day" — the existing, unchanged
-- default behavior; a captain only sets these when narrowing a specific day.
-- Local wall-clock time on `date` (Amsterdam) — no timezone column needed,
-- same reasoning as `date` itself.

ALTER TABLE public.staff_availability ADD COLUMN start_time time;
ALTER TABLE public.staff_availability ADD COLUMN end_time time;

ALTER TABLE public.staff_availability ADD CONSTRAINT staff_availability_time_range_valid
  CHECK (
    (start_time IS NULL AND end_time IS NULL)
    OR (start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
  );
