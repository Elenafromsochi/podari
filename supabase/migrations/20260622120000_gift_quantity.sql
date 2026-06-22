-- «Многоразовый» подарок: один и тот же подарок (особенно услуга) можно
-- подарить несколько раз. Карточка одна, у неё есть общий тираж (quantity)
-- и остаток (quantity_remaining). Каждая бронь уменьшает остаток на 1;
-- карточка остаётся в ленте, пока остаток > 0. Когда остаток дошёл до 0 —
-- подарок уходит из ленты (как «забронированный»), а владелец может
-- «Подарить снова», указав новое количество (описание сохраняется).

ALTER TABLE public.gifts
  ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS quantity_remaining integer NOT NULL DEFAULT 1;

-- Бэкфилл существующих подарков: тираж 1, остаток зависит от статуса.
-- Доступные → ещё можно забронировать (1); забронированные/подаренные → 0.
UPDATE public.gifts
  SET quantity = 1,
      quantity_remaining = CASE WHEN status = 'available' THEN 1 ELSE 0 END;

-- claim_gift: списываем один экземпляр из остатка. Пока остаток > 0 —
-- подарок остаётся 'available'; когда дошли до 0 — 'reserved' (уходит из ленты).
-- Возвращаем новый остаток, чтобы приложение могло прислать уведомления
-- «остался последний» / «разобрали все».
-- Меняется тип возврата (добавили remaining), поэтому функцию нужно сперва
-- удалить (CREATE OR REPLACE не умеет менять сигнатуру возврата). DROP сбрасывает
-- гранты — восстанавливаем их ниже.
DROP FUNCTION IF EXISTS public.claim_gift(uuid);
CREATE FUNCTION public.claim_gift(_gift_id uuid)
RETURNS TABLE(transaction_id uuid, chat_id uuid, remaining integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _me uuid := auth.uid();
  _owner uuid;
  _cost numeric;
  _remaining integer;
  _balance numeric;
  _tx_id uuid;
  _chat_id uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  SELECT owner_id, cost, quantity_remaining INTO _owner, _cost, _remaining
    FROM gifts WHERE id = _gift_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GIFT_NOT_FOUND'; END IF;
  IF _remaining IS NULL OR _remaining <= 0 THEN RAISE EXCEPTION 'ALREADY_TAKEN'; END IF;
  IF _owner = _me THEN RAISE EXCEPTION 'OWN_GIFT'; END IF;
  IF _owner IS NULL THEN RAISE EXCEPTION 'NO_OWNER'; END IF;
  SELECT balance INTO _balance FROM profiles WHERE user_id = _me FOR UPDATE;
  IF _balance IS NULL THEN RAISE EXCEPTION 'NO_PROFILE'; END IF;
  IF _balance < _cost THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;
  UPDATE profiles
    SET balance = balance - _cost,
        xp = xp + 10,
        level = public.calc_level(xp + 10),
        updated_at = now()
    WHERE user_id = _me;
  _remaining := _remaining - 1;
  UPDATE gifts
    SET quantity_remaining = _remaining,
        status = CASE WHEN _remaining <= 0 THEN 'reserved' ELSE 'available' END,
        updated_at = now()
    WHERE id = _gift_id;
  INSERT INTO transactions (gift_id, sender_id, receiver_id, amount, status)
  VALUES (_gift_id, _owner, _me, _cost, 'pending') RETURNING id INTO _tx_id;
  SELECT id INTO _chat_id FROM chats
    WHERE gift_id = _gift_id
      AND ((user_a = _owner AND user_b = _me) OR (user_a = _me AND user_b = _owner))
    LIMIT 1;
  IF _chat_id IS NULL THEN
    INSERT INTO chats (gift_id, user_a, user_b) VALUES (_gift_id, _owner, _me)
    RETURNING id INTO _chat_id;
  END IF;
  RETURN QUERY SELECT _tx_id, _chat_id, _remaining;
END;
$$;

-- Восстанавливаем доступ (DROP выше снёс гранты): только для вошедших,
-- как и было настроено в исходных миграциях.
REVOKE EXECUTE ON FUNCTION public.claim_gift(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_gift(uuid) TO authenticated;

-- confirm_handover: помечаем весь подарок 'gifted' только когда экземпляры
-- кончились (остаток 0). Для многоразового подарока в процессе — статус
-- не трогаем (он либо 'available' с остатком, либо 'reserved').
CREATE OR REPLACE FUNCTION public.confirm_handover(_transaction_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _me uuid := auth.uid(); _tx record;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  SELECT * INTO _tx FROM transactions WHERE id = _transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TX_NOT_FOUND'; END IF;
  IF _tx.receiver_id <> _me THEN RAISE EXCEPTION 'NOT_RECEIVER'; END IF;
  IF _tx.status <> 'pending' THEN RAISE EXCEPTION 'TX_NOT_PENDING'; END IF;
  UPDATE transactions SET status = 'completed' WHERE id = _transaction_id;
  UPDATE gifts
    SET status = CASE WHEN quantity_remaining <= 0 THEN 'gifted' ELSE status END,
        updated_at = now()
    WHERE id = _tx.gift_id;
  UPDATE profiles
    SET balance = balance + 0.8,
        xp = xp + 80,
        level = public.calc_level(xp + 80),
        updated_at = now()
    WHERE user_id = _tx.sender_id;
END;
$$;

-- cancel_claim: освобождаем экземпляр обратно в остаток (не выше тиража)
-- и снова делаем подарок доступным.
CREATE OR REPLACE FUNCTION public.cancel_claim(_transaction_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _me uuid := auth.uid(); _tx record;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  SELECT * INTO _tx FROM transactions WHERE id = _transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TX_NOT_FOUND'; END IF;
  IF _tx.receiver_id <> _me THEN RAISE EXCEPTION 'NOT_RECEIVER'; END IF;
  IF _tx.status <> 'pending' THEN RAISE EXCEPTION 'TX_NOT_PENDING'; END IF;
  UPDATE transactions SET status = 'cancelled' WHERE id = _transaction_id;
  UPDATE gifts
    SET quantity_remaining = LEAST(quantity, quantity_remaining + 1),
        status = 'available',
        updated_at = now()
    WHERE id = _tx.gift_id;
  UPDATE profiles SET balance = balance + _tx.amount, updated_at = now() WHERE user_id = _tx.receiver_id;
END;
$$;
