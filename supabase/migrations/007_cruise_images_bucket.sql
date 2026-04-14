-- Create public storage bucket for cruise listing images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'cruise-images',
  'cruise-images',
  true,
  10485760, -- 10MB per file
  ARRAY['image/jpeg','image/png','image/webp','image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Allow public read
CREATE POLICY "public read cruise images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'cruise-images');

-- Allow service role to upload/delete
CREATE POLICY "service role manage cruise images"
  ON storage.objects FOR ALL
  USING (bucket_id = 'cruise-images');
