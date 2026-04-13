-- Create public storage bucket for extras images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'extras-images',
  'extras-images',
  true,
  10485760, -- 10MB per file
  ARRAY['image/jpeg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Allow public read
CREATE POLICY "public read extras images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'extras-images');

-- Allow service role to upload/delete
CREATE POLICY "service role manage extras images"
  ON storage.objects FOR ALL
  USING (bucket_id = 'extras-images');
