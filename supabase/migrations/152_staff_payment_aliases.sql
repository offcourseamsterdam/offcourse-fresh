-- 152_staff_payment_aliases.sql
-- The bank often prints a nickname or initials instead of a staff member's real
-- name ("Schipper MG" for Mia G.), so transaction classification can miss them
-- entirely. This lets a staff row carry the alternate names their payments
-- actually arrive under.

ALTER TABLE public.staff
  ADD COLUMN IF NOT EXISTS payment_aliases text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.staff.payment_aliases IS
  'Alternate names/initials this person''s bank payments may appear under (e.g. "MG", "Schipper MG"), used by the finance transaction classifier alongside their real name.';
