-- Один балл при входе для всех. Реферал больше НЕ добавляет новичку второй балл.
-- Пригласившему остаётся только +50 XP (это не баллы).

CREATE OR REPLACE FUNCTION public.handle_referral_bonus()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.referred_by IS NOT NULL
     AND NEW.referred_by <> NEW.user_id
     AND (TG_OP = 'INSERT' OR OLD.referred_by IS DISTINCT FROM NEW.referred_by) THEN
    -- Пригласившему: +50 XP. Балл новичку НЕ начисляем — у всех ровно 1 балл на входе.
    UPDATE public.profiles
      SET xp = xp + 50, level = public.calc_level(xp + 50), updated_at = now()
      WHERE user_id = NEW.referred_by;
  END IF;
  RETURN NEW;
END;
$$;

-- На всякий случай выравниваем и «осиротевшую» функцию (она не вызывается,
-- но пусть тоже не даёт лишний балл, если кто-то её запустит).
CREATE OR REPLACE FUNCTION public.apply_referral_bonus(_new_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _ref uuid;
BEGIN
  SELECT referred_by INTO _ref FROM profiles WHERE user_id = _new_user;
  IF _ref IS NULL OR _ref = _new_user THEN RETURN; END IF;
  UPDATE profiles
    SET xp = xp + 50, level = public.calc_level(xp + 50), updated_at = now()
    WHERE user_id = _ref;
END;
$$;
