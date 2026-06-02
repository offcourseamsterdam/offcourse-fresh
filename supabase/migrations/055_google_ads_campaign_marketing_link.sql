-- Re-point the Google Ads bridge from "campaign → listing" to
-- "campaign → marketing campaign".
--
-- WHY: a Google Ads campaign's Final URL is a /t/<slug> tracking link, where the
-- slug is a row in the `campaigns` table (the marketing/attribution campaigns shown
-- in the admin Campaigns tab). That marketing campaign already knows its listing
-- (campaigns.listing_id). So the real connection is:
--
--     Google Ads campaign  →  marketing campaign  →  listing (derived)
--
-- The admin should pick the MARKETING CAMPAIGN; the listing follows from it and is
-- read-only. We keep listing_id/listing_slug as a denormalized cache (for per-listing
-- grouping + URL building) but they're now derived, not the source of truth.

alter table google_ads_campaign_listings
  add column if not exists marketing_campaign_id uuid references campaigns(id) on delete set null;

-- listing is now derived from the marketing campaign, so it may be absent.
alter table google_ads_campaign_listings alter column listing_id drop not null;
alter table google_ads_campaign_listings alter column listing_slug drop not null;

create index if not exists idx_gads_campaign_listings_marketing
  on google_ads_campaign_listings (marketing_campaign_id);

-- Backfill the one existing campaign: it points at /t/first-private-cruise-campaign.
update google_ads_campaign_listings
set marketing_campaign_id = (select id from campaigns where slug = 'first-private-cruise-campaign')
where campaign_id = '23903583517'
  and marketing_campaign_id is null;
