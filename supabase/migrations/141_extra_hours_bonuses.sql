-- 141: on-the-water upsell bonus (Beer, 2026-08-24: "if a captain upsells an
-- extra hour or 30 minutes, lets say its the last tour... they can have 50%
-- commission on that"). Admin logs what was charged; commission_cents is
-- computed and stored at log time (not recomputed from a rate at read time)
-- so a future rate change never reprices a past upsell — same principle as
-- review_bonuses.amount_cents.

CREATE TABLE public.extra_hours_bonuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id),
  date date NOT NULL,
  extra_minutes integer NOT NULL CHECK (extra_minutes > 0),
  amount_charged_cents integer NOT NULL CHECK (amount_charged_cents > 0),
  commission_cents integer NOT NULL CHECK (commission_cents >= 0),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.extra_hours_bonuses ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only, same as staff_availability / review_bonuses.
-- Admin logs it (requireAdmin); a captain's own finance view reads it through
-- requireCaptain, scoped server-side to their own staff_id.
