-- 137: "never propose a move on this one" flag (Beer, 2026-08-23: anniversary
-- or birthday bookings — admin sets this by hand after reading a note or
-- being told directly; nothing here tries to auto-detect it from free text).
-- Every reschedule move type (same-day, cross-day, boat-swap) must skip a
-- flagged booking entirely, same footing as the other hard eligibility rules
-- (category, catering, notice window).

ALTER TABLE public.bookings ADD COLUMN no_reschedule_ask boolean NOT NULL DEFAULT false;
ALTER TABLE public.bookings ADD COLUMN no_reschedule_reason text;
