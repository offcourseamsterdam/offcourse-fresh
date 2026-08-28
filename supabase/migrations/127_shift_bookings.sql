-- 127: one shift can cover MANY departures.
--
-- Until now a shift pointed at exactly one booking (shifts.booking_id UNIQUE)
-- or one shared departure (fareharbor_availability_pk UNIQUE). That made the
-- real-world case impossible to represent: a captain running three
-- back-to-back cruises on Diana is doing ONE block of work, not three
-- disconnected shifts. Those two UNIQUE indexes are exactly what blocked
-- merging, so they go; the columns stay (as the block's first/primary
-- departure) because a few read paths still use them.
--
-- shift_bookings is the new truth for "which departures does this shift
-- cover". Membership, not a single pointer.

CREATE TABLE IF NOT EXISTS public.shift_bookings (
  shift_id   uuid NOT NULL REFERENCES public.shifts(id)   ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shift_id, booking_id)
);

-- "which shift covers this booking" — the lookup Planning does per booking.
CREATE INDEX IF NOT EXISTS shift_bookings_booking_idx ON public.shift_bookings (booking_id);

-- RLS on by default (see CLAUDE.md — creating a table does NOT enable it).
-- No policies: every write and read goes through a service-role API route,
-- and the service role bypasses RLS. Anon gets nothing, which is correct —
-- this is internal crew scheduling, never public content.
ALTER TABLE public.shift_bookings ENABLE ROW LEVEL SECURITY;

-- Backfill from what the single-pointer columns already encode, so no
-- existing shift loses its link the moment the new code starts reading
-- membership instead.
INSERT INTO public.shift_bookings (shift_id, booking_id)
SELECT s.id, s.booking_id
FROM public.shifts s
WHERE s.booking_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- Shared departures: the shift points at the FareHarbor departure, and every
-- booking on that departure belongs to it.
INSERT INTO public.shift_bookings (shift_id, booking_id)
SELECT s.id, b.id
FROM public.shifts s
JOIN public.bookings b ON b.fareharbor_availability_pk = s.fareharbor_availability_pk
WHERE s.fareharbor_availability_pk IS NOT NULL
ON CONFLICT DO NOTHING;

-- The constraints that made merging impossible. (They are UNIQUE constraints,
-- not bare indexes — Postgres refuses DROP INDEX on an index a constraint owns.)
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_booking_id_key;
ALTER TABLE public.shifts DROP CONSTRAINT IF EXISTS shifts_fareharbor_availability_pk_key;

-- Both columns are now "the block's primary departure" (a hint for existing
-- read paths), not an identity. Non-unique lookups still want indexes.
CREATE INDEX IF NOT EXISTS shifts_booking_id_idx ON public.shifts (booking_id);
CREATE INDEX IF NOT EXISTS shifts_fh_availability_pk_idx ON public.shifts (fareharbor_availability_pk);
