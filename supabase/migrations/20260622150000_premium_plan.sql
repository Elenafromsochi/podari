-- Тариф пользователя для freemium-модели ИИ.
-- premium_until в будущем → premium (Global-модели), иначе free (RU-модели).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS premium_until timestamptz;

COMMENT ON COLUMN public.profiles.premium_until IS
  'До какого момента активна премиум-подписка (Global ИИ). NULL/в прошлом = бесплатный тариф.';
