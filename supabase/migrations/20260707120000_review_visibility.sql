-- Скрытый (ожидающий) отзыв дарителя.
-- Даритель может оставить отзыв о получателе в момент, когда отмечает передачу
-- подарка. Такой отзыв хранится СКРЫТЫМ и «фиксируется» (становится видимым и
-- приносит XP), только когда получатель подтвердит получение. Если сделка не
-- состоялась (получатель нажал «не получил» или отмена) — отзыв стирается
-- (это делает серверный код через service-role).

-- 1) Флаг видимости. Все существующие отзывы остаются видимыми (default true).
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS visible boolean NOT NULL DEFAULT true;

-- 2) XP за отзыв начисляем только за ВИДИМЫЙ отзыв (скрытый/ожидающий — не даёт XP).
CREATE OR REPLACE FUNCTION public.award_review_xp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _xp integer;
BEGIN
  -- Скрытый отзыв (ожидает подтверждения получателем) XP пока не приносит.
  IF NEW.visible IS DISTINCT FROM TRUE THEN
    RETURN NEW;
  END IF;
  _xp := CASE WHEN NEW.is_auto THEN 5 ELSE 20 END;
  IF NEW.author_id IS NOT NULL THEN
    UPDATE profiles
      SET xp = xp + _xp,
          level = public.calc_level(xp + _xp),
          updated_at = now()
      WHERE user_id = NEW.author_id;
  END IF;
  RETURN NEW;
END;
$$;

-- 3) Когда скрытый отзыв становится видимым (получатель подтвердил получение) —
--    начисляем XP автору именно в этот момент.
CREATE OR REPLACE FUNCTION public.award_review_xp_on_reveal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _xp integer;
BEGIN
  IF OLD.visible IS DISTINCT FROM TRUE AND NEW.visible IS TRUE THEN
    _xp := CASE WHEN NEW.is_auto THEN 5 ELSE 20 END;
    IF NEW.author_id IS NOT NULL THEN
      UPDATE profiles
        SET xp = xp + _xp,
            level = public.calc_level(xp + _xp),
            updated_at = now()
        WHERE user_id = NEW.author_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_award_review_xp_reveal ON public.reviews;
CREATE TRIGGER trg_award_review_xp_reveal
  AFTER UPDATE OF visible ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.award_review_xp_on_reveal();
