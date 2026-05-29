-- Tiered cancellation policy stored on the FareHarbor item.
-- Virtual cruise listings inherit the policy of their parent FH item.
-- Shape: jsonb array of {hours_before:int, refund_percent:int} sorted desc by hours_before.
-- NULL = use DEFAULT_TIERS (defined in src/lib/cancellation/policy.ts).

ALTER TABLE public.fareharbor_items
  ADD COLUMN IF NOT EXISTS cancellation_tiers jsonb;

COMMENT ON COLUMN public.fareharbor_items.cancellation_tiers IS
  'Array of {hours_before:int, refund_percent:int} sorted by hours_before desc. NULL = use DEFAULT_TIERS in src/lib/cancellation/policy.ts.';
