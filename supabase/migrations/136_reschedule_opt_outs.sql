-- 136: guest-level permanent opt-out from reschedule asks (Beer, 2026-08-23:
-- "one decline, never ask that guest again"). One decline on ANY booking, ANY
-- move type (same-day time-shift, cross-day, boat-swap) blocks every future
-- ask to that same guest, across all their future bookings too — not just a
-- per-booking dedupe like the existing sequential-per-day guard.
--
-- Matched by email OR phone (whichever the declining booking had) rather
-- than a guest/customer id, since no such table exists yet — bookings carry
-- contact fields directly.

CREATE TABLE public.reschedule_opt_outs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  phone text,
  booking_id uuid REFERENCES public.bookings(id),
  proposal_id uuid REFERENCES public.agent_proposals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reschedule_opt_outs_has_contact CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

CREATE INDEX reschedule_opt_outs_email_idx ON public.reschedule_opt_outs (email) WHERE email IS NOT NULL;
CREATE INDEX reschedule_opt_outs_phone_idx ON public.reschedule_opt_outs (phone) WHERE phone IS NOT NULL;

ALTER TABLE public.reschedule_opt_outs ENABLE ROW LEVEL SECURITY;
-- Service-role only (used exclusively by server-side Ghost code via
-- createAdminClient) — no anon policy needed, this is never read or written
-- from the browser.
