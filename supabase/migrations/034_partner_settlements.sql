-- Partner settlements: tracks when an admin has marked a partner+quarter as paid.
-- One row per (partner, quarter, settlement_type). Bookings stay untouched —
-- this is a separate, append-only ledger of payouts.

CREATE TABLE partner_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  quarter text NOT NULL,
  settlement_type text NOT NULL CHECK (settlement_type IN ('partner_invoice', 'affiliate')),
  amount_cents int NOT NULL,
  paid_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id, quarter, settlement_type)
);

ALTER TABLE partner_settlements ENABLE ROW LEVEL SECURITY;
-- No public policies — admin only via service role.

CREATE INDEX idx_partner_settlements_partner ON partner_settlements(partner_id, quarter);
