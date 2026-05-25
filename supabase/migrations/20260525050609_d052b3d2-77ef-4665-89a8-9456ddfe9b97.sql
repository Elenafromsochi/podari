
-- Таблица достижений
CREATE TABLE public.user_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  code text NOT NULL,
  xp_granted integer NOT NULL DEFAULT 0,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, code)
);

ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;

-- Любой пользователь может видеть свои достижения; для лидерборда оставляем публичный select
CREATE POLICY "user_achievements_select_all"
  ON public.user_achievements
  FOR SELECT
  USING (true);

-- Запись/удаление — только сервер через security definer функцию

CREATE INDEX idx_user_achievements_user ON public.user_achievements(user_id);

-- Функция: проверяет условия и идемпотентно начисляет все доступные достижения текущему пользователю.
-- Возвращает строки выданных СЕЙЧАС достижений (для UI-уведомлений).
CREATE OR REPLACE FUNCTION public.sync_achievements()
RETURNS TABLE(code text, xp_granted integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _posted_count int;
  _gifted_count int;
  _received_count int;
  _reviews_count int;
  _referrals_count int;
  _level int;
  _xp_total int := 0;
  _granted_codes text[] := ARRAY[]::text[];
  _granted_xps int[] := ARRAY[]::int[];
  _rec record;
  _ach record;
  -- Метаданные: code => xp, condition
  _achievements jsonb := '[
    {"code":"first_post",      "xp":10, "metric":"posted",    "threshold":1},
    {"code":"first_handover",  "xp":15, "metric":"gifted",    "threshold":1},
    {"code":"first_receive",   "xp":10, "metric":"received",  "threshold":1},
    {"code":"first_review",    "xp":10, "metric":"reviews",   "threshold":1},
    {"code":"giver_5",         "xp":30, "metric":"gifted",    "threshold":5},
    {"code":"receiver_5",      "xp":20, "metric":"received",  "threshold":5},
    {"code":"level_2",         "xp":25, "metric":"level",     "threshold":2},
    {"code":"first_referral",  "xp":30, "metric":"referrals", "threshold":1}
  ]'::jsonb;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'UNAUTHENTICATED';
  END IF;

  -- Считаем метрики
  SELECT COUNT(*) INTO _posted_count   FROM gifts WHERE owner_id = _me;
  SELECT COUNT(*) INTO _gifted_count   FROM transactions WHERE sender_id   = _me AND status = 'completed';
  SELECT COUNT(*) INTO _received_count FROM transactions WHERE receiver_id = _me AND status = 'completed';
  SELECT COUNT(*) INTO _reviews_count  FROM reviews WHERE author_id = _me;
  SELECT COUNT(*) INTO _referrals_count FROM profiles WHERE referred_by = _me;
  SELECT level INTO _level FROM profiles WHERE user_id = _me;
  IF _level IS NULL THEN _level := 1; END IF;

  -- Проходим список и выдаём
  FOR _ach IN
    SELECT * FROM jsonb_to_recordset(_achievements)
      AS x(code text, xp int, metric text, threshold int)
  LOOP
    DECLARE _value int;
    BEGIN
      _value := CASE _ach.metric
        WHEN 'posted'    THEN _posted_count
        WHEN 'gifted'    THEN _gifted_count
        WHEN 'received'  THEN _received_count
        WHEN 'reviews'   THEN _reviews_count
        WHEN 'referrals' THEN _referrals_count
        WHEN 'level'     THEN _level
        ELSE 0
      END;

      IF _value >= _ach.threshold THEN
        -- Идемпотентная вставка
        BEGIN
          INSERT INTO user_achievements (user_id, code, xp_granted)
          VALUES (_me, _ach.code, _ach.xp);
          -- Только если действительно вставили — начисляем XP
          UPDATE profiles
            SET xp = xp + _ach.xp,
                level = public.calc_level(xp + _ach.xp),
                updated_at = now()
            WHERE user_id = _me;
          _granted_codes := _granted_codes || _ach.code;
          _granted_xps   := _granted_xps   || _ach.xp;
        EXCEPTION WHEN unique_violation THEN
          -- уже было выдано — пропускаем
          NULL;
        END;
      END IF;
    END;
  END LOOP;

  -- Возвращаем то, что выдали сейчас
  FOR i IN 1..COALESCE(array_length(_granted_codes, 1), 0) LOOP
    code := _granted_codes[i];
    xp_granted := _granted_xps[i];
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;
