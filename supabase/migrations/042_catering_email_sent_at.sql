-- Add catering email tracking to bookings
-- Allows admin to mark when a catering order email has been sent to the supplier

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS catering_email_sent_at timestamptz;

-- Partial index for fast pending-count queries (only indexes rows where NOT yet sent)
CREATE INDEX IF NOT EXISTS bookings_catering_pending_idx
  ON public.bookings (catering_email_sent_at)
  WHERE catering_email_sent_at IS NULL;
