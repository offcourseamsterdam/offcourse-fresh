-- Add rich content columns to cruise_listings.
-- Instead of 7 separate tables (cruise_benefits, cruise_highlights, etc.),
-- everything lives as JSONB on the listing itself. Translations go inside
-- each JSON object: {"text": "Free drinks", "text_nl": "Gratis drankjes", ...}

-- Benefits: what guests get
-- e.g. [{"text": "Free soft drinks", "text_nl": "Gratis frisdrank", "icon": "glass"}]
ALTER TABLE public.cruise_listings ADD COLUMN IF NOT EXISTS benefits jsonb DEFAULT '[]';

-- Highlights: what makes this cruise special
-- e.g. [{"text": "Hidden gems route", "text_nl": "Verborgen parels route"}]
ALTER TABLE public.cruise_listings ADD COLUMN IF NOT EXISTS highlights jsonb DEFAULT '[]';

-- Inclusions: what's included / not included
-- e.g. [{"text": "Skipper", "included": true}, {"text": "Food", "included": false}]
ALTER TABLE public.cruise_listings ADD COLUMN IF NOT EXISTS inclusions jsonb DEFAULT '[]';

-- FAQs: question & answer pairs
-- e.g. [{"q": "Can we bring food?", "a": "Yes!", "q_nl": "...", "a_nl": "..."}]
ALTER TABLE public.cruise_listings ADD COLUMN IF NOT EXISTS faqs jsonb DEFAULT '[]';

-- Images: ordered gallery
-- e.g. [{"url": "https://...", "alt": "Canal view", "alt_nl": "Grachtzicht", "order": 1}]
ALTER TABLE public.cruise_listings ADD COLUMN IF NOT EXISTS images jsonb DEFAULT '[]';

-- Cancellation policy: plain text with translations inside JSONB
-- e.g. {"text": "Free cancellation up to 24h", "text_nl": "Gratis annuleren tot 24u"}
ALTER TABLE public.cruise_listings ADD COLUMN IF NOT EXISTS cancellation_policy jsonb DEFAULT '{}';

-- Duration display: human-readable duration shown on cards
-- e.g. "1.5 - 3 hours" or "2 hours"
ALTER TABLE public.cruise_listings ADD COLUMN IF NOT EXISTS duration_display text;

-- Max guests: shown on cards, derived from FH but overrideable
ALTER TABLE public.cruise_listings ADD COLUMN IF NOT EXISTS max_guests integer;
