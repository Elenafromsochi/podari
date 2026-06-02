
-- Таблица сообщений админу
CREATE TABLE public.admin_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  content text NOT NULL,
  image_path text,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_messages_status_created ON public.admin_messages (status, created_at DESC);

GRANT SELECT, INSERT ON public.admin_messages TO authenticated;
GRANT ALL ON public.admin_messages TO service_role;

ALTER TABLE public.admin_messages ENABLE ROW LEVEL SECURITY;

-- Пользователь может вставлять свои сообщения
CREATE POLICY "admin_messages_insert_own"
ON public.admin_messages FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND length(content) BETWEEN 1 AND 4000);

-- Пользователь может видеть только свои сообщения; админ — все
CREATE POLICY "admin_messages_select_own_or_admin"
ON public.admin_messages FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Только админ может обновлять статус
CREATE POLICY "admin_messages_update_admin"
ON public.admin_messages FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Политики на storage.objects для bucket 'admin-uploads'
-- Пользователь грузит в свою папку <user_id>/...
CREATE POLICY "admin_uploads_insert_own"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'admin-uploads'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Пользователь видит свои файлы, админ — все
CREATE POLICY "admin_uploads_select_own_or_admin"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'admin-uploads'
  AND (auth.uid()::text = (storage.foldername(name))[1] OR public.has_role(auth.uid(), 'admin'))
);
