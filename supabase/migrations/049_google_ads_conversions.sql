-- Google Ads conversion tracking (server-side Offline Conversion Import).
--
-- One row per Stripe PaymentIntent we attempt to report to Google Ads.
-- Acts as (a) the dedupe key so a conversion is uploaded at most once even if
-- Stripe re-delivers the webhook or the browser races it, and (b) an audit log
-- + retry surface for every upload attempt.

create table if not exists google_ads_conversions (
  -- The Stripe PaymentIntent id. Unique → the dedupe guarantee.
  payment_intent_id text primary key,
  gclid             text,
  value_cents       integer not null default 0,
  currency          text    not null default 'eur',
  -- pending | uploaded | failed | skipped_no_gclid | skipped_no_consent
  status            text    not null default 'pending',
  consent_marketing boolean,
  google_response   jsonb,
  error             text,
  uploaded_at       timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists idx_google_ads_conversions_status
  on google_ads_conversions (status);
create index if not exists idx_google_ads_conversions_created_at
  on google_ads_conversions (created_at desc);

-- Service-role only: written by the Stripe webhook (admin client bypasses RLS),
-- never touched by anon/auth clients. Enabling RLS with no policies denies all
-- non-service access.
alter table google_ads_conversions enable row level security;

-- Store the Google Click ID on the booking too, for admin visibility
-- (which bookings came from a Google ad). Nullable — most bookings have none.
alter table bookings add column if not exists gclid text;
