
-- ===== 1. Wipe demo data =====
TRUNCATE TABLE public.reviews, public.messages, public.transactions, public.chats, public.gifts, public.profiles RESTART IDENTITY CASCADE;
DELETE FROM auth.users;

-- ===== 2. auth_nonces table =====
CREATE TABLE public.auth_nonces (
  nonce text PRIMARY KEY,
  code text,
  telegram_id bigint,
  telegram_username text,
  telegram_first_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  consumed_at timestamptz
);

CREATE INDEX idx_auth_nonces_expires ON public.auth_nonces (expires_at);

ALTER TABLE public.auth_nonces ENABLE ROW LEVEL SECURITY;
-- No policies: access only via service role (server functions).

-- ===== 3. Add telegram_id to profiles for lookup =====
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS telegram_id bigint UNIQUE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS telegram_username text;
