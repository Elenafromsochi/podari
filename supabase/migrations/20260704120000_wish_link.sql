-- Ссылка на пример подарка в желании (URL на товар/референс). Необязательное поле.
ALTER TABLE public.wishes ADD COLUMN IF NOT EXISTS link text;
