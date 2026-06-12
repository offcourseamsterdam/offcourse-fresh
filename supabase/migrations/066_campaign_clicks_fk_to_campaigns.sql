-- campaign_clicks.campaign_id was FK'd to the legacy campaign_links table,
-- while logClick() (the /t/<slug> redirect) inserts ids from the newer
-- campaigns table. Every insert violated the FK and was silently swallowed,
-- so the click ledger stayed empty. Repoint the FK to campaigns.
-- The only existing row was a click on a test link with no parent campaign.

DELETE FROM campaign_clicks
WHERE campaign_id NOT IN (SELECT id FROM campaigns);

ALTER TABLE campaign_clicks
  DROP CONSTRAINT campaign_clicks_campaign_id_fkey;

ALTER TABLE campaign_clicks
  ADD CONSTRAINT campaign_clicks_campaign_id_fkey
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
