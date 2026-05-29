-- SECURITY FIX (CRITICAL): stop the `anon` role from reading google_reviews_config.
--
-- Migration 016 created a broad `anon SELECT USING (true)` policy back when the
-- table held only public rating stats. Migration 017 then ADDED OAuth columns
-- (oauth_access_token, oauth_refresh_token, ...) to the SAME table — so the long-
-- lived Google Business Profile refresh token became readable by anyone holding
-- the public anon key (which ships in the browser bundle).
--
-- Every application reader uses the service-role client (createAdminClient), which
-- bypasses RLS, so removing the anon policy breaks nothing. Service role retains
-- full access via google_reviews_config_service_all (migration 016).

DROP POLICY IF EXISTS google_reviews_config_anon_select ON google_reviews_config;
