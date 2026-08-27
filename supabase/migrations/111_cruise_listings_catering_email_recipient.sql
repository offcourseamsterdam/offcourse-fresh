-- 111_cruise_listings_catering_email_recipient.sql
-- Lets a listing's catering supplier order go to a different email than the
-- site-wide default (env CATERING_EMAIL_RECIPIENT) — e.g. the Curaçao Jamaican
-- Buffet Cruise's food is prepped by an external caterer (Ash), not the usual
-- supplier, so that listing's orders must reach the external caterer's own inbox.
--
-- NULL (the default) means "use the site-wide default" — every existing listing
-- keeps behaving exactly as before.
ALTER TABLE cruise_listings
  ADD COLUMN IF NOT EXISTS catering_email_recipient text;

COMMENT ON COLUMN cruise_listings.catering_email_recipient IS
  'Overrides CATERING_EMAIL_RECIPIENT for this listing''s catering supplier order emails. NULL = use the site-wide default. Also signals "this is an external-supplier food cruise" — when set, a Slack DM additionally goes to Beer alongside the normal #bookings catering alert (see notifyCateringOrder).';
