-- Whether the AI's own availability check found the requested private-cruise
-- slot bookable — stamped as real structured data (not left to the Haiku
-- summary's prose) so the inbox list can show a reliable checkmark/cross
-- icon instead of trusting free text. Null when not applicable (booking
-- already confirmed) or not yet checked.
ALTER TABLE public.conversations
  ADD COLUMN ota_available boolean NULL;
