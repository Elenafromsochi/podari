-- get_public_profiles отдавал только display_name/level/xp — при просмотре
-- чужого профиля (/user/:userId) фото и «о себе» читались напрямую из
-- profiles через обычный клиент, а RLS-политика profiles_select_own
-- разрешает читать только свою же строку. В итоге у любого другого
-- пользователя фото и описание молча не показывались.
-- Меняем набор возвращаемых колонок — CREATE OR REPLACE этого не позволяет
-- (42P13: cannot change return type of existing function), нужно сначала удалить.
DROP FUNCTION IF EXISTS public.get_public_profiles(uuid[]);

CREATE FUNCTION public.get_public_profiles(_user_ids uuid[])
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
