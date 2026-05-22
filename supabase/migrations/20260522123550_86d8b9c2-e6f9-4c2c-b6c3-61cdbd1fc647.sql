DELETE FROM public.gifts WHERE owner_id IS NULL;
ALTER TABLE public.gifts ALTER COLUMN owner_id SET NOT NULL;