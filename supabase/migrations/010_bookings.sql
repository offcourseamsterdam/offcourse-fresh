-- Extend existing bookings table with columns needed for our checkout flow.
-- The bookings table already exists (from the previous Lovable app).
-- We add columns rather than create a new table, per the implementation plan.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS stripe_amount integer,
  ADD COLUMN IF NOT EXISTS fareharbor_availability_pk bigint,
  ADD COLUMN IF NOT EXISTS fareharbor_customer_type_rate_pk bigint,
  ADD COLUMN IF NOT EXISTS guest_count integer,
  ADD COLUMN IF NOT EXISTS listing_id uuid,
  ADD COLUMN IF NOT EXISTS listing_title text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS booking_date date,
  ADD COLUMN IF NOT EXISTS end_time timestamptz,
  ADD COLUMN IF NOT EXISTS guest_note text;

-- Index for common queries from the admin bookings page
CREATE INDEX IF NOT EXISTS bookings_booking_date_idx ON public.bookings (booking_date DESC);
CREATE INDEX IF NOT EXISTS bookings_stripe_pi_idx ON public.bookings (stripe_payment_intent_id);
