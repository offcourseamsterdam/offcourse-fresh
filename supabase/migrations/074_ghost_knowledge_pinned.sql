-- 074: pinned facts — a must-always-inject hedge for ghost_knowledge.
-- Recency selection (newest 20) silently drops old-but-critical facts (boat
-- capacities, refund policy). Pinned rows are ALWAYS injected regardless of age,
-- buying much of relevance-retrieval's benefit for none of pgvector's cost.
ALTER TABLE public.ghost_knowledge ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;
