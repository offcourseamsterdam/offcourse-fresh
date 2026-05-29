-- 046_campaigns_settlement_model.sql
-- Add settlement_model to campaigns so the partner settlement summary can
-- correctly categorise bookings as either:
--   - 'affiliate' (Off Course collected; we owe partner the commission)
--   - 'reseller'  (Partner collected at their desk; partner owes Off Course)
--
-- The existing settlement-summary endpoint only used booking_source = 'partner_invoice'
-- to flip the direction, which doesn't fit the WeBikeAmsterdam "Front Desk" model
-- where the guest pays €0 online via a 100%-off promo code but the partner collected
-- cash at their desk.
--
-- Default 'affiliate' preserves existing behaviour for all campaigns.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS settlement_model TEXT
    NOT NULL DEFAULT 'affiliate'
    CHECK (settlement_model IN ('affiliate', 'reseller'));

COMMENT ON COLUMN campaigns.settlement_model IS
  'Direction of settlement: affiliate = Off Course owes partner commission; reseller = partner owes Off Course (they collected at their desk and the customer used a 100%-off code).';
