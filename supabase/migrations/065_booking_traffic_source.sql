-- Traffic source attribution on bookings.
-- Derived at checkout from first-party cookies (gclid, campaign link, first-touch
-- referrer/UTM) and stored via the Stripe webhook so every booking records where
-- the customer originally came from.
--   traffic_source: 'google-ads' | 'campaign' | 'social' | 'email' | 'organic'
--                 | 'referral' | 'partners' | 'direct'
--   traffic_detail: campaign slug, utm_source, or referrer hostname

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS traffic_source text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS traffic_detail text;
