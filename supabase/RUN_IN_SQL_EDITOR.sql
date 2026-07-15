-- =====================================================================
--  «Подари» — выполнить один раз в Supabase → SQL Editor → New query →
--  вставить всё это → Run. Безопасно запускать повторно (IF NOT EXISTS /
--  CREATE OR REPLACE) — ничего не сломает, если что-то уже применено.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Ссылка-пример в желании (поле «🔗 пример подарка» в форме желания).
-- ---------------------------------------------------------------------
ALTER TABLE public.wishes
  ADD COLUMN IF NOT EXISTS link text;

-- ---------------------------------------------------------------------
-- 2) Скрытый (ожидающий) отзыв дарителя.
--    Даритель оставляет отзыв в момент передачи; он хранится скрытым и
--    «фиксируется» (виден + даёт XP) только после подтверждения получателем.
-- ---------------------------------------------------------------------
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS visible boolean NOT NULL DEFAULT true;

-- XP за отзыв — только за видимый (скрытый пока не приносит XP).
CREATE OR REPLACE FUNCTION public.award_review_xp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _xp integer;
BEGIN
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

-- Когда скрытый отзыв становится видимым — начисляем XP автору тогда же.
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

-- ---------------------------------------------------------------------
-- 3) Подарочный сертификат — «режим сертификата» и срок действия.
-- ---------------------------------------------------------------------
ALTER TABLE public.gifts
  ADD COLUMN IF NOT EXISTS is_certificate boolean NOT NULL DEFAULT false;
ALTER TABLE public.gifts
  ADD COLUMN IF NOT EXISTS cert_expires_at timestamptz;

-- Готово ✅  Проверить можно так (обе строки должны вернуться):
--   select column_name from information_schema.columns
--     where table_name='wishes' and column_name='link';
--   select column_name from information_schema.columns
--     where table_name='reviews' and column_name='visible';
