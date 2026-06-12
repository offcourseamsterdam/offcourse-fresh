-- 073: ghost_knowledge — the Ghost's long-term memory, taught by humans.
-- Two sources: answers to questions the Ghost itself asked (the questions
-- panel on /admin/ghost), and manually added facts. Every entry is injected
-- into future draft prompts, so each answer permanently changes behavior —
-- the "bit by bit" learning Beer can watch happen.

CREATE TABLE public.ghost_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question text NOT NULL,             -- what the Ghost (or a human) asked
  answer text NOT NULL,               -- the team's answer — this is the knowledge
  source text NOT NULL DEFAULT 'question_panel'
    CHECK (source IN ('question_panel', 'manual')),
  proposal_id uuid NULL REFERENCES public.agent_proposals(id) ON DELETE SET NULL,
  created_by text NULL,               -- admin display name
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ghost_knowledge_created_idx ON public.ghost_knowledge (created_at DESC);
CREATE INDEX ghost_knowledge_proposal_idx ON public.ghost_knowledge (proposal_id);

ALTER TABLE public.ghost_knowledge ENABLE ROW LEVEL SECURITY;
