-- get_public_profiles отдавал только display_name/level/xp — при просмотре
-- чужого профиля (/user/:userId) фото и «о себе» читались напрямую из
-- profiles через обычный клиент, а RLS-политика profiles_select_own
-- разрешает читать только свою же строку. В итоге у любого другого
-- пользователя фото и описание молча не показывались.
CREATE OR REPLACE FUNCTION public.get_public_profiles(_user_ids uuid[])
RETURNS TABLE (
  user_id uuid,
  display_name text,
  level int,
  xp int,
  avatar_url text,
  about text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id, display_name, level, xp, avatar_url, about
  FROM public.profiles
  WHERE user_id = ANY(_user_ids);
$$;

GRANT EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) TO anon, authenticated;
