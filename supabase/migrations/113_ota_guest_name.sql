-- The actual guest's name, when an OTA's notification happens to expose it
-- (GetMyBoat does; Withlocals' request notification does not) — kept separate
-- from contacts.name, which for an OTA-relayed conversation is the platform's
-- own relay address, not the guest.
ALTER TABLE public.conversations
  ADD COLUMN ota_guest_name text NULL;
