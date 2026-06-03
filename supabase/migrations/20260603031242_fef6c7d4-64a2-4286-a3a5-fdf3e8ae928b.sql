ALTER TABLE public.gifts  ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.wishes ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}'::text[];