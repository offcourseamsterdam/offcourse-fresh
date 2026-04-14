-- Add FareHarbor customer type PKs to boats
-- These are the PKs that belong to each boat (from External API item 234922)
-- Note: live boats table uses id, is_active, max_capacity, display_order (not slug/active/max_guests/sort_order)
ALTER TABLE boats
  ADD COLUMN IF NOT EXISTS fareharbor_customer_type_pks bigint[] DEFAULT '{}';

-- Seed Diana's PKs: 1.5h (1247681), 2h (1247682), 3h (1247683)
UPDATE boats SET fareharbor_customer_type_pks = ARRAY[1247681, 1247682, 1247683]
WHERE id = '30ff589a-7198-4926-b1b2-275458f7d553';

-- Seed Curaçao's PKs: 1.5h (1247684), 2h (1247685), 3h (1247687)
UPDATE boats SET fareharbor_customer_type_pks = ARRAY[1247684, 1247685, 1247687]
WHERE id = '3f1d9d7a-e069-40c0-8a1a-9e28e3a634ea';

-- Add boat_id to cruise_listings (nullable — not every listing needs a boat assigned)
ALTER TABLE cruise_listings
  ADD COLUMN IF NOT EXISTS boat_id uuid REFERENCES boats(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS cruise_listings_boat_id_idx ON cruise_listings (boat_id);
