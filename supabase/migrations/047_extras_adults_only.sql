-- 047_extras_adults_only.sql
-- Add adults_only flag to extras. When true on a per-person-pick extra
-- (one with min_people set), the booking-flow counter caps at the booking's
-- ADULT count, not the total guest count. Use case: Unlimited Drinks —
-- can't be sold per-child.
--
-- Default false preserves existing behaviour.

ALTER TABLE extras
  ADD COLUMN IF NOT EXISTS adults_only BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN extras.adults_only IS
  'When true on a per-person extra with min_people set, the counter is capped at the booking adult-count (not total guest count). Used for items that cannot be sold to children, e.g. Unlimited Drinks.';
