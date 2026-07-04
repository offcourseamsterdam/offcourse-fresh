-- Maintenance & Ideas board — the maintenance agent's first slice.
-- People post in the Slack "Maintenance and Ideas" channel (text and/or a
-- photo); the Ghost assigns each a priority — essential / cosmetic / wishlist —
-- describes any photos (Gemini), and drafts a technician quote-request email. The
-- email SEND is a human-approved Ghost action (agent_proposals kind
-- 'maintenance_task', shadow -> sending -> executed); this table is the
-- durable record + the admin board.
--
-- Posture: RLS ON with NO policies (service-role only via API routes), same
-- as bookings / staff / shifts.

-- ============================================================
-- maintenance_tasks — one reported issue or idea.
-- ============================================================
CREATE TABLE public.maintenance_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  boat_id uuid NULL REFERENCES public.boats(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text NULL,
  -- How urgent the fix is (triage axis, not "what type of thing"):
  --   essential = must-fix (safety / boat can't run well)
  --   cosmetic  = nice-to-fix (appearance / comfort)
  --   wishlist  = future idea / nice-to-have
  priority text NOT NULL DEFAULT 'essential'
    CHECK (priority IN ('essential', 'cosmetic', 'wishlist')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'done', 'dismissed')),
  -- Photos uploaded to the cruise-images bucket; descriptions are the
  -- Gemini read-outs (kept parallel so the technician email can use words).
  photo_urls text[] NOT NULL DEFAULT '{}',
  photo_descriptions text[] NOT NULL DEFAULT '{}',
  source text NOT NULL DEFAULT 'slack' CHECK (source IN ('slack', 'admin')),
  source_slack_event_id text NULL,
  source_channel text NULL,
  reporter text NULL,
  -- The Ghost proposal that carries the drafted technician email.
  proposal_id uuid NULL REFERENCES public.agent_proposals(id) ON DELETE SET NULL,
  technician_emailed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX maintenance_tasks_status_idx ON public.maintenance_tasks (status);
CREATE INDEX maintenance_tasks_boat_id_idx ON public.maintenance_tasks (boat_id);
-- One task per Slack event — a replayed Slack delivery can't double-insert.
CREATE UNIQUE INDEX maintenance_tasks_slack_event_idx
  ON public.maintenance_tasks (source_slack_event_id)
  WHERE source_slack_event_id IS NOT NULL;

CREATE TRIGGER maintenance_tasks_updated_at
  BEFORE UPDATE ON public.maintenance_tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.maintenance_tasks ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- agent_proposals: allow the transient 'sending' claim status used by the
-- maintenance technician-email send action (atomic shadow -> sending ->
-- executed, mirroring the booking 'booking' claim added in migration 076).
-- Without it the claim UPDATE violates the status CHECK and the send 500s
-- before the email goes out.
-- ============================================================
ALTER TABLE public.agent_proposals DROP CONSTRAINT IF EXISTS agent_proposals_status_check;
ALTER TABLE public.agent_proposals ADD CONSTRAINT agent_proposals_status_check
  CHECK (status IN ('shadow', 'proposed', 'approved', 'rejected', 'expired', 'booking', 'sending', 'executed'));
