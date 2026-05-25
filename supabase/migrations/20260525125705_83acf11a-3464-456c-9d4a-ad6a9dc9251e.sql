
-- 1) Profiles: разрешить пользователю менять только display_name
DROP POLICY IF EXISTS profiles_update_self ON public.profiles;

-- Полностью отзываем UPDATE у authenticated на таблице, затем выдаём только на display_name
REVOKE UPDATE ON public.profiles FROM authenticated, anon, public;
GRANT UPDATE (display_name) ON public.profiles TO authenticated;

-- RLS-политика: пользователь может обновлять только свою строку (и только разрешённую колонку — благодаря column GRANT)
CREATE POLICY profiles_update_display_name_self
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 2) Reviews: жёстче проверяем INSERT — нужна реальная транзакция, в которой автор и адресат участвуют
DROP POLICY IF EXISTS reviews_insert_author ON public.reviews;

CREATE POLICY reviews_insert_author
ON public.reviews
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = author_id
  AND transaction_id IS NOT NULL
  AND target_id IS NOT NULL
  AND author_id <> target_id
  AND EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.id = transaction_id
      AND (t.sender_id = auth.uid() OR t.receiver_id = auth.uid())
      AND (t.sender_id = target_id  OR t.receiver_id = target_id)
      AND t.sender_id <> t.receiver_id
  )
);
