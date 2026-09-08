-- A PostgreSQL restore can omit triggers attached to the auth schema even
-- while keeping the public trigger function. Restore the trigger and repair
-- any auth users created while it was absent.
BEGIN;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (
    user_id,
    display_name,
    balance,
    xp,
    level,
    telegram_id,
    telegram_username,
    referred_by
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', 'Гость'),
    1,
    0,
    1,
    NULLIF(NEW.raw_user_meta_data->>'telegram_id', '')::bigint,
    NEW.raw_user_meta_data->>'telegram_username',
    NULLIF(NEW.raw_user_meta_data->>'referred_by', '')::uuid
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

INSERT INTO public.profiles (
  user_id,
  display_name,
  balance,
  xp,
  level,
  telegram_id,
  telegram_username,
  referred_by
)
SELECT
  users.id,
  COALESCE(users.raw_user_meta_data->>'display_name', 'Гость'),
  1,
  0,
  1,
  NULLIF(users.raw_user_meta_data->>'telegram_id', '')::bigint,
  users.raw_user_meta_data->>'telegram_username',
  NULLIF(users.raw_user_meta_data->>'referred_by', '')::uuid
FROM auth.users AS users
LEFT JOIN public.profiles AS profiles ON profiles.user_id = users.id
WHERE profiles.user_id IS NULL
ON CONFLICT (user_id) DO NOTHING;

COMMIT;
