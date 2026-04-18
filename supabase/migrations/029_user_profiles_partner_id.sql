-- Link partner users to their partner record
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES partners(id);
