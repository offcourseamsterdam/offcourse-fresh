-- Audit log for AI-generated image metadata writes.
-- Every automated write stores the previous value so admin can revert.
-- Cleanup policy: rows older than 30 days can be purged (not enforced here).

CREATE TABLE image_seo_history (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  table_name     text NOT NULL,
  row_id         text NOT NULL,          -- uuid or compound key as text
  field_name     text NOT NULL,          -- e.g. 'alt_text_en', 'images[2].alt_text.nl'
  previous_value text,
  new_value      text,
  source         text NOT NULL DEFAULT 'batch',  -- 'batch' | 'upload-auto' | 'manual-regen'
  session_id     uuid,                   -- groups items from a single run
  applied_at     timestamptz NOT NULL DEFAULT now(),
  reverted_at    timestamptz
);

CREATE INDEX idx_image_seo_history_row
  ON image_seo_history (table_name, row_id);

CREATE INDEX idx_image_seo_history_applied
  ON image_seo_history (applied_at DESC);

CREATE INDEX idx_image_seo_history_session
  ON image_seo_history (session_id)
  WHERE session_id IS NOT NULL;

ALTER TABLE image_seo_history ENABLE ROW LEVEL SECURITY;

-- Only service role reads/writes. Admin UI goes through API routes.
CREATE POLICY "service_all_image_seo_history"
  ON image_seo_history FOR ALL
  TO service_role
  USING (true);
