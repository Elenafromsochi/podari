-- Больше игровых целей: те же метрики (posted/gifted/received/reviews/
-- referrals/level), только повыше порогом — чтобы после первых наград
-- оставался повод возвращаться. Никаких новых метрик и изменений схемы —
-- user_achievements.code обычный text без CHECK/enum.
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
    {"code":"first_referral",  "xp":0,  "metric":"referrals", "threshold":1},
    {"code":"poster_10",       "xp":30, "metric":"posted",    "threshold":10},
    {"code":"giver_10",        "xp":40, "metric":"gifted",    "threshold":10},
    {"code":"giver_20",        "xp":60, "metric":"gifted",    "threshold":20},
    {"code":"receiver_10",     "xp":30, "metric":"received",  "threshold":10},
    {"code":"reviews_5",       "xp":25, "metric":"reviews",   "threshold":5},
    {"code":"referrals_3",     "xp":0,  "metric":"referrals", "threshold":3},
    {"code":"referrals_10",    "xp":0,  "metric":"referrals", "threshold":10},
    {"code":"level_3",         "xp":30, "metric":"level",     "threshold":3},
    {"code":"level_4",         "xp":35, "metric":"level",     "threshold":4},
    {"code":"level_5",         "xp":40, "metric":"level",     "threshold":5}
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
