-- 1) Remove gifts/chats from realtime publication (no client subscribes to them)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'gifts'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.gifts';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chats'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.chats';
  END IF;
END $$;

-- 2) Admin-only UPDATE/DELETE on admin-uploads bucket
DROP POLICY IF EXISTS "admin_uploads_update_admin" ON storage.objects;
CREATE POLICY "admin_uploads_update_admin"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'admin-uploads' AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (bucket_id = 'admin-uploads' AND public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admin_uploads_delete_admin" ON storage.objects;
CREATE POLICY "admin_uploads_delete_admin"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'admin-uploads' AND public.has_role(auth.uid(), 'admin'::public.app_role));