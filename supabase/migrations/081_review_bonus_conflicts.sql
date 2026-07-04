-- review_bonus_conflicts: when a review mentions a name shared by 2+ active
-- staff members, awarding the bonus automatically is wrong. Instead of picking
-- one, the system stores a conflict here and surfaces a card on the Reviews
-- admin page so Beer can decide who gets it (or skip it entirely).
--
-- resolved_at IS NULL = pending decision
-- resolved_at IS NOT NULL + awarded_staff_id set = bonus awarded to that person
-- resolved_at IS NOT NULL + awarded_staff_id NULL = deliberately skipped

CREATE TABLE public.review_bonus_conflicts (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id           uuid        NOT NULL REFERENCES public.social_proof_reviews(id) ON DELETE CASCADE,
  matched_name        text        NOT NULL,
  candidate_staff_ids uuid[]      NOT NULL,
  resolved_at         timestamptz,
  awarded_staff_id    uuid        REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, matched_name)
);

-- Fast lookup for the "pending" banner in the Reviews page.
CREATE INDEX ON public.review_bonus_conflicts (resolved_at) WHERE resolved_at IS NULL;

ALTER TABLE public.review_bonus_conflicts ENABLE ROW LEVEL SECURITY;
-- No policies: all access goes through service-role API routes.
