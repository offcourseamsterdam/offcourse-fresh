-- Stock / storage — the storage agent's first slice.
-- Staff scan a QR in the storage room → a phone form with +/- buttons → submit.
-- When an item drops to/below its reorder threshold, the Ghost drafts a supplier
-- reorder email (agent_proposals kind 'stock_reorder', shadow -> sending ->
-- executed) for one-click human approval. This table is the durable catalog +
-- the live count; the reorder draft itself lives in agent_proposals.
--
-- Posture: RLS ON with NO policies (service-role only via API routes). The
-- public QR count route reaches it through createAdminClient AFTER an HMAC
-- token check, same as the extras-upsell page.

CREATE TABLE public.stock_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,                       -- "Ice tea", "Wine — Red", "Beer tray"
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('drinks', 'snacks', 'supplies', 'other')),
  -- How it's counted & ordered: the pack you physically grab.
  unit text NOT NULL DEFAULT 'tray',        -- tray / box / case / can / bottle
  -- Optional pack contents, so counts know their base total and the reorder
  -- email is precise: white wine box = 12 bottles, beer tray = 24 cans.
  pack_size integer CHECK (pack_size IS NULL OR pack_size > 0),
  pack_unit text,                           -- "bottles" / "cans"
  location text,                            -- "Storage box A", "Fridge"
  -- The "2 left → reorder 5" rule, per item:
  current_count integer NOT NULL DEFAULT 0 CHECK (current_count >= 0),
  reorder_threshold integer NOT NULL DEFAULT 0 CHECK (reorder_threshold >= 0),
  reorder_qty integer NOT NULL DEFAULT 0 CHECK (reorder_qty >= 0),
  supplier_name text,
  supplier_email text,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  last_counted_at timestamptz,
  -- 'slack' is reserved for the planned Slack text count path (see stock-agent.md
  -- "How to extend"); today only 'qr' and 'admin' are written.
  counted_via text CHECK (counted_via IN ('qr', 'admin', 'slack')),
  -- Stamped when a supplier reorder email for this item is sent (so the board
  -- can show "ordered 2d ago" and the drafter can avoid re-drafting too soon).
  last_reordered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX stock_items_active_idx ON public.stock_items (active, sort_order);

CREATE TRIGGER stock_items_updated_at
  BEFORE UPDATE ON public.stock_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.stock_items ENABLE ROW LEVEL SECURITY;
