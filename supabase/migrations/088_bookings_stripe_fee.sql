-- Stripe's own processing fee (in cents) for a booking's charge, resolved via
-- the charge's balance_transaction. Only ever set for bookings that actually
-- went through Stripe (stripe_payment_intent_id is not null) — reseller
-- (GetYourGuide/Viator/TripAdvisor) and complimentary bookings never have one.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS stripe_fee_cents integer;
