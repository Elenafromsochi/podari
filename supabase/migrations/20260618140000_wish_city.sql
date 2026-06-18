-- Город и флаг «онлайн» у желаний — как у подарков. Город говорит дарителю,
-- кому рядом можно помочь; онлайн-желания (например, онлайн-консультация)
-- исполнимы из любого города.
ALTER TABLE public.wishes ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.wishes ADD COLUMN IF NOT EXISTS is_online boolean NOT NULL DEFAULT false;
