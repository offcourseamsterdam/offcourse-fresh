-- review_bonuses: records a €5 bonus every time a staff member's first name
-- appears in a synced review (Google or TripAdvisor). One bonus per
-- (staff, review) pair — the UNIQUE constraint makes re-scanning idempotent.
-- Bonuses are included in the payroll tab and visible on each staff profile.

CREATE TABLE public.review_bonuses (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     uuid        NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  review_id    uuid        NOT NULL REFERENCES public.social_proof_reviews(id) ON DELETE CASCADE,
  amount_cents integer     NOT NULL DEFAULT 500,
  awarded_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, review_id)
);

CREATE INDEX ON public.review_bonuses (staff_id);
CREATE INDEX ON public.review_bonuses (review_id);

ALTER TABLE public.review_bonuses ENABLE ROW LEVEL SECURITY;
-- No policies: all access goes through service-role API routes.
