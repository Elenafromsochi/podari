
-- 1. Profiles: restrict SELECT to own row, expose safe columns via view
DROP POLICY IF EXISTS profiles_select_all ON public.profiles;

CREATE POLICY profiles_select_own
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS profiles_insert_self ON public.profiles;
CREATE POLICY profiles_insert_self
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Safe public view (display_name, level, xp only)
CREATE OR REPLACE VIEW public.profiles_public
WITH (security_invoker = on) AS
  SELECT user_id, display_name, level, xp, created_at
  FROM public.profiles;

GRANT SELECT ON public.profiles_public TO anon, authenticated;

-- Allow anyone to read the safe view rows
CREATE POLICY profiles_select_public_safe
  ON public.profiles FOR SELECT
  TO anon, authenticated
  USING (true);

-- ^ this would re-open base table. Instead: use a SECURITY DEFINER function for cross-user reads.
DROP POLICY IF EXISTS profiles_select_public_safe ON public.profiles;

-- Helper function: returns safe public profile data for any user (bypasses RLS via SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.get_public_profiles(_user_ids uuid[])
RETURNS TABLE (user_id uuid, display_name text, level int, xp int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id, display_name, level, xp
  FROM public.profiles
  WHERE user_id = ANY(_user_ids);
$$;

REVOKE ALL ON FUNCTION public.get_public_profiles(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) TO anon, authenticated;

-- 2. Gifts: tighten insert (no NULL owner)
DROP POLICY IF EXISTS gifts_insert_owner ON public.gifts;
CREATE POLICY gifts_insert_owner
  ON public.gifts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = owner_id);

-- 3. Realtime broadcast/presence: deny by default (app only uses postgres_changes, gated by table RLS)
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS realtime_deny_all ON realtime.messages;
CREATE POLICY realtime_deny_all
  ON realtime.messages FOR SELECT
  TO anon, authenticated
  USING (false);

-- 4. auth_nonces & telegram_referrals — explicit deny (service-role only)
DROP POLICY IF EXISTS auth_nonces_deny_all ON public.auth_nonces;
CREATE POLICY auth_nonces_deny_all
  ON public.auth_nonces FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS telegram_referrals_deny_all ON public.telegram_referrals;
CREATE POLICY telegram_referrals_deny_all
  ON public.telegram_referrals FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);
