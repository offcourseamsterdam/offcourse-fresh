-- 072: ai_usage — the Ghost's fuel gauge.
-- Every AI call records its tokens + computed cost. ai_usage_alerts keeps
-- one row per €5 threshold crossed (PK = threshold), so the Slack alert
-- for a given threshold can fire exactly once even under concurrent calls.

CREATE TABLE public.ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature text NOT NULL,                 -- 'ghost_reply_draft' | 'ghost_schedule_day' | 'ghost_catering_order' | 'chat_translate' | …
  model text NOT NULL,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cost_eur_cents numeric(12,4) NOT NULL, -- fractions of a cent matter at this volume
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_usage_created_idx ON public.ai_usage (created_at DESC);
CREATE INDEX ai_usage_feature_idx ON public.ai_usage (feature);

CREATE TABLE public.ai_usage_alerts (
  threshold_eur integer PRIMARY KEY,     -- 5, 10, 15, … — insert-once = alert-once
  notified_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_alerts ENABLE ROW LEVEL SECURITY;
