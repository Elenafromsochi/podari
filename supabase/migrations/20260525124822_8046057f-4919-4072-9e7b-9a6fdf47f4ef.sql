
-- 1. user_achievements: owner-only read
DROP POLICY IF EXISTS user_achievements_select_all ON public.user_achievements;
CREATE POLICY user_achievements_select_own ON public.user_achievements
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 2. reviews: restrict reads to authenticated only (still visible for reputation, hidden from anon)
DROP POLICY IF EXISTS reviews_select_all ON public.reviews;
CREATE POLICY reviews_select_authenticated ON public.reviews
  FOR SELECT TO authenticated USING (true);

-- 3. calc_level: pin search_path
CREATE OR REPLACE FUNCTION public.calc_level(_xp integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _xp >= 1700 THEN 5
    WHEN _xp >= 1000 THEN 4
    WHEN _xp >= 500  THEN 3
    WHEN _xp >= 200  THEN 2
    ELSE 1
  END
$$;

-- 4. Revoke EXECUTE on SECURITY DEFINER functions from anon; keep authenticated where the app needs them
REVOKE EXECUTE ON FUNCTION public.claim_gift(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.confirm_handover(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.request_handover(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.decline_handover(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_claim(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_achievements() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.apply_referral_bonus(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_gift(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_handover(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_handover(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_handover(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_claim(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_achievements() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) TO authenticated;
