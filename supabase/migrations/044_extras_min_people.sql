-- 044_extras_min_people.sql
-- Add minimum-people requirement to per-person catering extras.
--
-- When set on a per_person_cents extra, this signals "customer picks people count
-- for this item" semantics: pricing = qty × price_value (qty represents people,
-- decoupled from booking.guestCount). Counter starts at this value on activation,
-- decrementing below it deselects the item.
--
-- NULL = legacy behavior (per-person applies automatically to all booking guests).

ALTER TABLE extras
  ADD COLUMN IF NOT EXISTS min_people integer;

COMMENT ON COLUMN extras.min_people IS
  'When set on a per_person_cents extra: minimum people-count required to order this item. Counter starts at this value; pricing = qty × price_value (qty represents people, decoupled from booking guestCount). NULL = legacy behavior (applies to all booking guests).';
