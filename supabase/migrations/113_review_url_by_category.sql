-- Migration 113: Split the TripAdvisor review link by cruise category
--
-- The single tripadvisor_review_url field couldn't express that shared and
-- private cruises are actually different TripAdvisor listings needing
-- different "write a review" links. Splits it into two, resolved by /r/review
-- at click time based on the clicking booking's category (via the ?b= param
-- already logged for click analytics but previously unused for routing).

ALTER TABLE google_reviews_config
  ADD COLUMN IF NOT EXISTS tripadvisor_review_url_shared  text,
  ADD COLUMN IF NOT EXISTS tripadvisor_review_url_private text;

COMMENT ON COLUMN google_reviews_config.tripadvisor_review_url_shared IS
  'Direct TripAdvisor "write a review" link for SHARED cruises. /r/review resolves
  to this or the _private variant at click time based on the booking category
  looked up from the ?b= booking id param.';
COMMENT ON COLUMN google_reviews_config.tripadvisor_review_url_private IS
  'Direct TripAdvisor "write a review" link for PRIVATE cruises (and any category
  other than shared). See tripadvisor_review_url_shared.';

UPDATE google_reviews_config SET
  tripadvisor_review_url_shared = 'https://www.tripadvisor.com/UserReviewEdit-g188590-d33274622-Small_Shared_Canal_Cruise_Local_Captain_and_Hidden_Gems_Amsterdam-Amsterdam_North_Holland_P.html',
  tripadvisor_review_url_private = 'https://www.tripadvisor.com/UserReviewEdit-g188590-d33286129-Private_Canal_Cruise_Local_Captains_and_Hidden_Gems_Amsterdam-Amsterdam_North_Holland_Provi.html';

ALTER TABLE google_reviews_config DROP COLUMN IF EXISTS tripadvisor_review_url;
