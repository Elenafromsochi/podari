
-- 1. Flag in profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS password_set boolean NOT NULL DEFAULT false;

-- 2. Trusted devices
CREATE TABLE IF NOT EXISTS public.trusted_devices (
  user_id uuid NOT NULL,
  device_id text NOT NULL,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, device_id)
);

ALTER TABLE public.trusted_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trusted_devices_select_own"
  ON public.trusted_devices FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "trusted_devices_delete_own"
  ON public.trusted_devices FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON public.trusted_devices(user_id);

-- 3. Device login codes (server-only)
CREATE TABLE IF NOT EXISTS public.device_login_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  device_id text NOT NULL,
  code text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.device_login_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "device_login_codes_deny_all"
  ON public.device_login_codes FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_device_login_codes_user ON public.device_login_codes(user_id);

-- 4. Fast lookup by @username
CREATE INDEX IF NOT EXISTS idx_profiles_telegram_username_lower
  ON public.profiles (lower(telegram_username));
