-- Add quantity mode support to extras
-- 'toggle' = current on/off behavior (default)
-- 'counter' = plus/minus with quantity number (for food platters etc.)
ALTER TABLE extras ADD COLUMN IF NOT EXISTS quantity_mode text NOT NULL DEFAULT 'toggle';

-- Minimum quantity when using counter mode (e.g. 2 for food platters)
ALTER TABLE extras ADD COLUMN IF NOT EXISTS min_quantity integer NOT NULL DEFAULT 1;
