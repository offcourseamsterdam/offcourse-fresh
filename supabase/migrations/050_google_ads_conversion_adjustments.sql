-- Refund handling for Google Ads conversions.
-- When a booking is refunded, we tell Google to retract (full refund) or
-- restate (partial refund) the conversion so reported revenue stays honest.
-- These columns record the adjustment on the existing conversion row.

alter table google_ads_conversions
  add column if not exists adjustment_status text;       -- retracted | restated | adjustment_failed
alter table google_ads_conversions
  add column if not exists adjusted_at timestamptz;
alter table google_ads_conversions
  add column if not exists adjustment_response jsonb;
