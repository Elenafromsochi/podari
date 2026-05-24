CREATE TABLE IF NOT EXISTS public.telegram_referrals (
  telegram_id bigint PRIMARY KEY,
  referred_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.telegram_referrals ENABLE ROW LEVEL SECURITY;