-- Migration 114: Cruise availability snapshots for LLM/bot indexing and instant SSR
--
-- Caches a compact, structured availability snapshot per virtual listing.
-- Populated by the 3x-daily cron (/api/cron/availability-sync) and updated on
-- confirmed bookings.
--
-- Enables Server Components (both /cruises and /cruises/[slug]) to render
-- absolute upcoming departure timestamps and Schema.org metadata in initial HTML
-- with < 5ms DB query time, without hammering FareHarbor API.

CREATE TABLE IF NOT EXISTS public.cruise_availability_snapshots (
  listing_id UUID PRIMARY KEY REFERENCES public.cruise_listings(id) ON DELETE CASCADE,
  fareharbor_item_pk BIGINT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('private', 'shared')),
  next_available_slot TIMESTAMPTZ,
  upcoming_days JSONB NOT NULL DEFAULT '[]'::JSONB,
  schedule_summary JSONB NOT NULL DEFAULT '{}'::JSONB,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_availability_window_days INTEGER NOT NULL DEFAULT 14
);

-- Public read access so public Server Components (or anon client) can read
ALTER TABLE public.cruise_availability_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_snapshots" ON public.cruise_availability_snapshots;
CREATE POLICY "public_read_snapshots" ON public.cruise_availability_snapshots
  FOR SELECT
  TO anon, authenticated
  USING (true);

COMMENT ON TABLE public.cruise_availability_snapshots IS
  'Precomputed, compact availability snapshots per virtual cruise listing for SEO/GEO/AEO bots and instant SSR rendering.';
