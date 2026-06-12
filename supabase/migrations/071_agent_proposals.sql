-- 071: agent_proposals — the shadow AI's notebook.
-- One table for ALL proposal kinds (vision doc §1/§6): reply drafts now,
-- schedule/stock/booking proposals later. Status 'shadow' = generated and
-- logged but never shown to a customer; the trust ladder starts here.

CREATE TABLE public.agent_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,                              -- 'reply_draft' | 'schedule_week' | 'stock_order' | …
  conversation_id uuid NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  trigger_message_id uuid NULL REFERENCES public.messages(id) ON DELETE SET NULL,
  payload jsonb NOT NULL,                          -- the proposed action (zod-validated per kind in app code)
  reasoning text NULL,                             -- the agent explains itself, always
  status text NOT NULL DEFAULT 'shadow'
    CHECK (status IN ('shadow', 'proposed', 'approved', 'rejected', 'expired', 'executed')),
  model text NULL,                                 -- which model produced it (auditability)
  human_edits jsonb NULL,                          -- what the human changed before approving (learning signal)
  outcome jsonb NULL,                              -- what actually happened (closes the loop)
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX agent_proposals_kind_created_idx ON public.agent_proposals (kind, created_at DESC);
CREATE INDEX agent_proposals_conversation_idx ON public.agent_proposals (conversation_id);

-- Service-role only — same posture as bookings. No anon/auth policies.
ALTER TABLE public.agent_proposals ENABLE ROW LEVEL SECURITY;
