-- Add booking cutoff fields to fareharbor_items
--
-- booking_cutoff_hours: how many hours before a slot's start time online
--   booking is blocked. NULL = no cutoff (all slots bookable online).
--
-- max_slot_capacity: the "fresh" (no-bookings) capacity for this item's
--   slots, used to detect whether at least one booking already exists on a
--   shared-cruise slot. NULL = treat like a private boat (exception never
--   fires — capacity starts at 1 and hitting 0 means sold-out anyway).

ALTER TABLE fareharbor_items
  ADD COLUMN IF NOT EXISTS booking_cutoff_hours integer DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS max_slot_capacity    integer DEFAULT NULL;
