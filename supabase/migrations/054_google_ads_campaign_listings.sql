-- Maps a Google Ads campaign to the cruise listing it advertises.
--
-- Campaigns themselves live in Google (not in our DB); this table is the bridge
-- between the Google Ads world and the virtual-product layer. One row per
-- campaign (a campaign promotes exactly one listing); a listing may have several
-- campaigns. Lets the admin dashboard:
--   • group ad spend/profit per cruise listing, and
--   • auto-derive a campaign's landing URL from the listing slug at creation time.

create table if not exists google_ads_campaign_listings (
  campaign_id  text primary key,            -- Google Ads campaign id
  listing_id   uuid not null references cruise_listings(id) on delete cascade,
  listing_slug text not null,               -- denormalized for URL/display without a join
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_gads_campaign_listings_listing
  on google_ads_campaign_listings (listing_id);

-- Service-role only: written by admin API routes (service-role client bypasses
-- RLS). Enabling RLS with no policies denies all anon/auth access.
alter table google_ads_campaign_listings enable row level security;
