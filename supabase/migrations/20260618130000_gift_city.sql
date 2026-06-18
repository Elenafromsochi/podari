-- Город у подарка и у профиля + флаг «онлайн» (без привязки к городу).
-- Город нужен, чтобы люди видели местные вещи/услуги; онлайн-подарки
-- (консультации, медитации и т.п.) доступны в любом городе.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.gifts ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.gifts ADD COLUMN IF NOT EXISTS is_online boolean NOT NULL DEFAULT false;
