-- Private file bucket. Apply only after owner approval.
-- Objects are stored as {userId}/{storageName}. The Render API uses the service role.

INSERT INTO storage.buckets (id, name, public)
VALUES ('ash-private-files', 'ash-private-files', false)
ON CONFLICT (id) DO NOTHING;

-- Restrictive: even if other Storage policies exist, anon/authenticated cannot access this bucket.
-- The Render API uses the service role, which bypasses RLS.
DROP POLICY IF EXISTS ash_storage_client_deny ON storage.objects;
CREATE POLICY ash_storage_client_deny ON storage.objects
  AS RESTRICTIVE
  FOR ALL TO anon, authenticated
  USING (bucket_id <> 'ash-private-files')
  WITH CHECK (bucket_id <> 'ash-private-files');

INSERT INTO schema_migrations (version)
VALUES ('20261101_003_storage')
ON CONFLICT (version) DO NOTHING;
