-- 139: drop the 'prefer_not' status (Beer, 2026-08-23: "prefer not to should
-- be removed. available, or partly available. if people make it red we know
-- not to call them for last minutes"). A vague third mood-state added no
-- real signal for last-minute calling decisions; "partly available" is now
-- expressed precisely via the start_time/end_time window from migration 138
-- instead of a manual guess.
--
-- The only existing 'prefer_not' rows are Beer's own dev-bypass test data
-- (4 rows, all staff_id 3d80216f-618d-4d15-b9d0-9c1f0255c5fa "Beer Zoomers",
-- Aug 2026) — folded into 'available', since a maybe-captain should still be
-- callable, which is the actual point of removing the vague state.

UPDATE public.staff_availability SET status = 'available' WHERE status = 'prefer_not';

ALTER TABLE public.staff_availability DROP CONSTRAINT staff_availability_status_check;
ALTER TABLE public.staff_availability ADD CONSTRAINT staff_availability_status_check
  CHECK (status IN ('available', 'unavailable'));
