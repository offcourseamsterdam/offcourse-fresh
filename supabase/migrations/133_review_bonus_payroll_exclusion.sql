-- Beer, 2026-08-23: "we wont pay out bonuses this month" — the 2026-08-22/23
-- backfill scan (docs/plans/2026-08-22-reviews-bonuses-and-attribution.md
-- Phase "pre assign with AI") retroactively found and awarded ~50 bonuses
-- for reviews going back to late 2025. payroll-query.ts buckets a bonus into
-- a pay period by its awarded_at timestamp, which for every backfilled
-- bonus is "today" regardless of how old the underlying review actually is
-- — so without this, August payroll would suddenly owe the full backlog in
-- one lump sum.
--
-- excluded_from_payroll marks exactly that backlog so payroll-query.ts can
-- skip it; new bonuses awarded going forward (live ingestion, or a human
-- resolving a conflict) default to false and are never affected. Every
-- review_bonuses row that exists at the moment this migration runs came
-- from that backfill (the feature only shipped 2026-08-22), so the one-time
-- UPDATE below is safe and complete — no per-row filtering needed.
ALTER TABLE review_bonuses
  ADD COLUMN excluded_from_payroll boolean NOT NULL DEFAULT false;

UPDATE review_bonuses SET excluded_from_payroll = true;
