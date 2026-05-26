
ALTER TABLE public.device_login_codes
  ADD COLUMN IF NOT EXISTS pending_access_token text,
  ADD COLUMN IF NOT EXISTS pending_refresh_token text;
