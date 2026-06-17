-- Экономика желаний: баллы назначает сам загадавший, списываются при ИСПОЛНЕНИИ
-- (а не при создании). Загадывать желания можно бесплатно, сколько угодно.

-- 1) Стоимость желания в баллах (1..5), по умолчанию 1.
ALTER TABLE public.wishes
  ADD COLUMN IF NOT EXISTS cost integer NOT NULL DEFAULT 1;

ALTER TABLE public.wishes
  DROP CONSTRAINT IF EXISTS wishes_cost_range;
ALTER TABLE public.wishes
  ADD CONSTRAINT wishes_cost_range CHECK (cost >= 1 AND cost <= 5);

-- 2) publish_wish: без списания баланса, сохраняем выбранную стоимость.
--    Старую 4-аргументную версию убираем, новая принимает _cost с дефолтом —
--    поэтому вызов со старыми 4 аргументами тоже продолжит работать.
DROP FUNCTION IF EXISTS public.publish_wish(text, text, text, text);
CREATE OR REPLACE FUNCTION public.publish_wish(
  _title text, _description text, _image_url text, _category text, _cost integer DEFAULT 1
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _wish_id uuid;
  _c integer := COALESCE(_cost, 1);
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  IF coalesce(trim(_title), '') = '' THEN RAISE EXCEPTION 'EMPTY_TITLE'; END IF;
  IF _c < 1 THEN _c := 1; END IF;
  IF _c > 5 THEN _c := 5; END IF;

  -- Загадывать желание бесплатно: баланс НЕ трогаем. За активность — немного XP.
  UPDATE profiles
    SET xp = xp + 10,
        level = public.calc_level(xp + 10),
        updated_at = now()
    WHERE user_id = _me;

  INSERT INTO wishes (owner_id, title, description, image_url, category, cost)
  VALUES (_me, _title, NULLIF(_description, ''), NULLIF(_image_url, ''),
          COALESCE(NULLIF(_category, ''), 'разное'), _c)
  RETURNING id INTO _wish_id;

  RETURN _wish_id;
END;
$$;

-- 3) confirm_wish_received: переносим баллы желания от загадавшего к исполнителю.
CREATE OR REPLACE FUNCTION public.confirm_wish_received(_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _tx record;
  _wish_cost integer;
  _wisher_balance numeric;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  SELECT * INTO _tx FROM wish_transactions WHERE id = _transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TX_NOT_FOUND'; END IF;
  IF _tx.wisher_id <> _me THEN RAISE EXCEPTION 'NOT_WISHER'; END IF;
  IF _tx.status <> 'pending' THEN RAISE EXCEPTION 'TX_NOT_PENDING'; END IF;

  SELECT cost INTO _wish_cost FROM wishes WHERE id = _tx.wish_id;
  _wish_cost := COALESCE(_wish_cost, 1);

  SELECT balance INTO _wisher_balance FROM profiles WHERE user_id = _me FOR UPDATE;
  IF _wisher_balance IS NULL THEN RAISE EXCEPTION 'NO_PROFILE'; END IF;
  IF _wisher_balance < _wish_cost THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;

  UPDATE wish_transactions SET status = 'completed' WHERE id = _transaction_id;
  UPDATE wishes SET status = 'fulfilled', updated_at = now() WHERE id = _tx.wish_id;

  -- загадавший: -cost баллов, +10 XP
  UPDATE profiles
    SET balance = balance - _wish_cost,
        xp = xp + 10,
        level = public.calc_level(xp + 10),
        updated_at = now()
    WHERE user_id = _me;

  -- исполнитель: +cost баллов, +80 XP
  UPDATE profiles
    SET balance = balance + _wish_cost,
        xp = xp + 80,
        level = public.calc_level(xp + 80),
        updated_at = now()
    WHERE user_id = _tx.giver_id;
END;
$$;
