-- Public read of gift images (matches public readability of public.gifts)
DROP POLICY IF EXISTS "gift_images_read_public" ON storage.objects;
CREATE POLICY "gift_images_read_public"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'gift-images');

-- Authenticated users upload into their own folder: <auth.uid()>/<file>
DROP POLICY IF EXISTS "gift_images_insert_own" ON storage.objects;
CREATE POLICY "gift_images_insert_own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'gift-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "gift_images_update_own" ON storage.objects;
CREATE POLICY "gift_images_update_own"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'gift-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'gift-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "gift_images_delete_own" ON storage.objects;
CREATE POLICY "gift_images_delete_own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'gift-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );