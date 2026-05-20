
-- Триггерные функции — никто извне не должен их дёргать
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.award_publish_xp() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.award_review_xp() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;

-- Бизнес-функции — только для авторизованных
REVOKE EXECUTE ON FUNCTION public.claim_gift(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.confirm_handover(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_gift(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_handover(uuid) TO authenticated;

-- calc_level — чистая функция, безвредно
GRANT EXECUTE ON FUNCTION public.calc_level(integer) TO PUBLIC;
