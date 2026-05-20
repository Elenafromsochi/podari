ALTER TABLE public.gifts ALTER COLUMN cost SET DEFAULT 100;
UPDATE public.gifts SET cost = 100 WHERE cost <> 100;