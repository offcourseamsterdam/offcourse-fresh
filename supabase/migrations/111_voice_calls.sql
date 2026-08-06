-- Voice as a fourth inbox channel (channel='voice' already allowed by the
-- original conversations CHECK constraint). A call's audio isn't text like
-- every other channel, so messages needs somewhere to point at it — the
-- human-readable outcome/transcript still goes in the existing `body` column
-- (e.g. "Missed call — voicemail: ..."), keeping this addition minimal.
ALTER TABLE public.messages
  ADD COLUMN recording_url text NULL;
