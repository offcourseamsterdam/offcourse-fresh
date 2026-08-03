-- Private storage bucket for the original source documents behind finance
-- ingestion (Viator .xlsx payment advices, GetYourGuide payment PDFs, etc.)
-- so an admin can view/download the real file behind any parsed figure —
-- not just the numbers we extracted from it. Unlike every other bucket in
-- this project (cruise photos etc.), this one is PRIVATE: it contains bank
-- IBANs, VAT numbers, and real revenue figures, so it's accessed only via
-- short-lived signed URLs from admin routes, never a public URL.

INSERT INTO storage.buckets (id, name, public)
VALUES ('finance-attachments', 'finance-attachments', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "service_role_full_access_finance_attachments" ON storage.objects
  FOR ALL
  USING (bucket_id = 'finance-attachments' AND (auth.jwt() ->> 'role'::text) = 'service_role'::text);

-- Retrofit: let existing Viator batches (and future sources) point at their
-- original file in the bucket above.
ALTER TABLE viator_payment_batches
  ADD COLUMN IF NOT EXISTS storage_path text;
