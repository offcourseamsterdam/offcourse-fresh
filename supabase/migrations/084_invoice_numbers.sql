-- 084_invoice_numbers.sql
-- Atomic sequential VAT invoice numbering (Belastingdienst compliance).
--
-- Uses a Postgres SEQUENCE (nextval is non-transactional — never rolled back,
-- so two concurrent callers can never receive the same value) combined with
-- a FOR UPDATE lock inside the allocation function to serialise concurrent
-- calls for the *same* PI and make resends idempotent.

-- 1. Global counter — gapless within the sequence; the year prefix in the
--    formatted number is cosmetic, not a per-year reset.
CREATE SEQUENCE IF NOT EXISTS public.invoice_seq
  START 1
  INCREMENT 1
  NO CYCLE;

-- 2. Column to persist the allocated number on the booking row.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS invoice_number text;

-- 3. Unique constraint — one invoice number per booking (also catches
--    any future bug that would try to mint two numbers for one booking).
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_invoice_number_unique UNIQUE (invoice_number);

-- 4. Atomic allocation function.
--    * Idempotent: if the booking already has a number, return it unchanged.
--    * Atomic: nextval + update happen in one DB round-trip under the lock.
--    * SECURITY DEFINER so the anon/authenticated role can't call it directly;
--      only the service-role (our server code) has EXECUTE.
CREATE OR REPLACE FUNCTION public.allocate_invoice_number(p_stripe_pi_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing text;
  v_seq      bigint;
  v_year     int;
  v_number   text;
BEGIN
  -- Lock the row so a concurrent call for the same PI waits here.
  -- If the row doesn't exist we raise immediately — the booking must be
  -- committed before calling this function.
  SELECT invoice_number
  INTO   v_existing
  FROM   public.bookings
  WHERE  stripe_payment_intent_id = p_stripe_pi_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'allocate_invoice_number: no booking found for stripe_payment_intent_id = %', p_stripe_pi_id;
  END IF;

  -- Idempotent: already allocated (resend or concurrent winner).
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  -- Allocate and format the next invoice number.
  v_seq    := nextval('public.invoice_seq');
  v_year   := EXTRACT(YEAR FROM NOW())::int;
  v_number := 'OC-' || v_year || '-' || lpad(v_seq::text, 5, '0');

  -- Persist so any future call (resend, retry) returns the same number.
  UPDATE public.bookings
  SET    invoice_number = v_number
  WHERE  stripe_payment_intent_id = p_stripe_pi_id;

  RETURN v_number;
END;
$$;

-- Grant to service_role only (used by createAdminClient in server code).
GRANT EXECUTE ON FUNCTION public.allocate_invoice_number(text) TO service_role;
-- Revoke from public/anon/authenticated so clients can't call it directly.
REVOKE EXECUTE ON FUNCTION public.allocate_invoice_number(text) FROM PUBLIC;
