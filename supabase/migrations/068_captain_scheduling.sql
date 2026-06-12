-- Captain scheduling, roles, time tracking (Stage 1).
-- See docs/plans/captain-scheduling-build-brief.md.
--
-- Posture: RLS ON with NO policies on every new table (same as bookings) —
-- all reads/writes go through API routes using the service-role client,
-- which bypasses RLS. anon/authenticated can do nothing directly.

-- ============================================================
-- staff — the people who run cruises (skippers, hosts).
-- Separate from user_profiles: a staff member may have no login at all
-- (admin schedules them, Slack reminds them); user_id links one when
-- they get portal access.
-- ============================================================
CREATE TABLE public.staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NULL REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  name text NOT NULL,
  phone text NULL,
  email text NULL,
  role text NOT NULL CHECK (role IN ('skipper', 'host')),
  hourly_rate_cents integer NOT NULL DEFAULT 0,
  slack_member_id text NULL,
  calendar_token uuid NOT NULL DEFAULT gen_random_uuid(),
  is_active boolean NOT NULL DEFAULT true,
  max_shifts_per_week integer NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- shifts — one work slot on one boat. Usually generated from a confirmed
-- booking (booking_id set, UNIQUE = at most one shift per booking);
-- manual shifts (maintenance day, charter hold) have booking_id NULL.
-- ============================================================
CREATE TABLE public.shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  boat_id uuid NOT NULL REFERENCES public.boats(id),
  staff_id uuid NULL REFERENCES public.staff(id) ON DELETE SET NULL,
  booking_id uuid NULL UNIQUE REFERENCES public.bookings(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'assigned', 'confirmed', 'completed', 'cancelled')),
  reminder_sent_at timestamptz NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX shifts_date_idx ON public.shifts (date);
CREATE INDEX shifts_staff_id_idx ON public.shifts (staff_id);

CREATE TRIGGER shifts_updated_at
  BEFORE UPDATE ON public.shifts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- staff_availability — per-day availability set by the captain in their
-- portal. One row per staff per day; absent row = no preference stated.
-- ============================================================
CREATE TABLE public.staff_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  date date NOT NULL,
  status text NOT NULL CHECK (status IN ('available', 'unavailable', 'prefer_not')),
  note text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (staff_id, date)
);

ALTER TABLE public.staff_availability ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- time_entries — append-only clock in/out ledger. hourly_rate_cents is a
-- SNAPSHOT of the staff rate at creation so later rate changes never
-- rewrite past payroll. flag marks entries needing review; resolving a
-- flag keeps the flag + who resolved it (append-only spirit).
-- ============================================================
CREATE TABLE public.time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id),
  shift_id uuid NULL REFERENCES public.shifts(id) ON DELETE SET NULL,
  clock_in_at timestamptz NOT NULL DEFAULT now(),
  clock_out_at timestamptz NULL,
  source text NOT NULL CHECK (source IN ('slack', 'portal', 'admin')),
  hourly_rate_cents integer NOT NULL,
  flag text NULL CHECK (flag IN ('auto_closed', 'manual_edit', 'overlong', 'no_shift')),
  flag_resolved_by uuid NULL REFERENCES public.user_profiles(id),
  note text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX time_entries_staff_clock_in_idx ON public.time_entries (staff_id, clock_in_at);

ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- webhook_logs — table already exists (Stripe webhook writes it: source,
-- payload, headers, processed, error). The build brief assumed it was
-- missing; instead of recreating, ADD the columns Slack event dedupe
-- needs. provider_event_id UNIQUE makes replayed Slack deliveries no-ops
-- (insert conflicts → already handled).
-- ============================================================
ALTER TABLE public.webhook_logs
  ADD COLUMN provider_event_id text NULL UNIQUE,
  ADD COLUMN signature_valid boolean NULL,
  ADD COLUMN processed_at timestamptz NULL;

-- It predates the RLS-on posture; nothing reads it with the anon key,
-- so bring it in line with the other service-role-only tables.
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;
