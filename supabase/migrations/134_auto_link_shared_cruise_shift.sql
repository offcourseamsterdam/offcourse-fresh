-- Migration 134: auto-link a new booking to its shared cruise's existing captain
--
-- Problem: a captain gets assigned to a FareHarbor availability slot via a
-- shift_bookings row on ONE of that slot's bookings. Any booking that arrives
-- on the same slot AFTER that assignment never gets its own shift_bookings
-- row — nothing re-checks it. The Planning UI and the review-SMS captain
-- sign-off then show that later booking as unassigned even though the slot
-- genuinely has a captain.
--
-- Fix: on every booking insert/availability-pk update, if this booking's
-- fareharbor_availability_pk already has a captain (via any OTHER booking on
-- the same slot linked through shift_bookings), link this booking to that
-- same shift immediately. Wrapped in EXCEPTION WHEN OTHERS so this can never
-- block a real booking from being created, mirroring the fire-and-forget
-- safety principle already used for emitOpsEvent() elsewhere in this project.

CREATE OR REPLACE FUNCTION auto_link_shared_cruise_shift_booking()
RETURNS TRIGGER AS $$
DECLARE
  existing_shift_id uuid;
BEGIN
  IF NEW.fareharbor_availability_pk IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT sb.shift_id INTO existing_shift_id
  FROM shift_bookings sb
  JOIN bookings b ON b.id = sb.booking_id
  WHERE b.fareharbor_availability_pk = NEW.fareharbor_availability_pk
    AND b.id != NEW.id
  LIMIT 1;

  IF existing_shift_id IS NOT NULL THEN
    INSERT INTO shift_bookings (shift_id, booking_id)
    VALUES (existing_shift_id, NEW.id)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block a booking insert/update over this — same principle as
  -- emitOpsEvent()'s fire-and-forget error swallowing.
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auto_link_shared_cruise_shift_booking_trigger ON bookings;

CREATE TRIGGER auto_link_shared_cruise_shift_booking_trigger
  AFTER INSERT OR UPDATE OF fareharbor_availability_pk ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION auto_link_shared_cruise_shift_booking();

COMMENT ON FUNCTION auto_link_shared_cruise_shift_booking() IS
  'Auto-links a booking to an already-assigned captain''s shift when it shares
  a fareharbor_availability_pk with a booking that is already linked via
  shift_bookings. Fires on insert and on fareharbor_availability_pk changing.
  Deliberately does not backfill existing unlinked bookings — only prevents
  the gap going forward.';
