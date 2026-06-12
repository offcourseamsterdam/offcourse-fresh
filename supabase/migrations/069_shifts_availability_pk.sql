-- Shared cruises: several bookings belong to one FareHarbor departure
-- (availability), and one departure = one sailing = one shift. The pk lets
-- the sync upsert ONE shift per shared departure; private shifts keep
-- using booking_id (UNIQUE) as their identity.
-- Decision Beer 2026-06-12: shared shifts default to Curaçao, editable per shift.

ALTER TABLE public.shifts
  ADD COLUMN fareharbor_availability_pk bigint NULL UNIQUE;
