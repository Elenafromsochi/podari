ALTER TABLE public.gifts
  ADD COLUMN IF NOT EXISTS cost_flag boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_gifts_cost_flag ON public.gifts (cost_flag) WHERE cost_flag = true;
CREATE INDEX IF NOT EXISTS idx_gifts_kind_category ON public.gifts (gift_kind, category);