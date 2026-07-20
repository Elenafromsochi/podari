-- История баллов: кто, сколько и за что получил/потратил.
-- Пишут только SECURITY DEFINER функции ниже (клиенту insert не разрешён),
-- читать может только сам пользователь свою историю.
CREATE TABLE IF NOT EXISTS public.balance_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  delta numeric(10,2) NOT NULL,
  reason text NOT NULL,
  gift_id uuid REFERENCES public.gifts(id) ON DELETE SET NULL,
  wish_id uuid REFERENCES public.wishes(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.balance_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "balance_events_select_own" ON public.balance_events;
CREATE POLICY "balance_events_select_own" ON public.balance_events
  FOR SELECT USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS balance_events_user_idx ON public.balance_events (user_id, created_at DESC);

-- 0) Регистрация: стартовый 1 балл — тоже попадает в историю.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _rows integer;
BEGIN
  INSERT INTO public.profiles (user_id, display_name, balance, xp, level, telegram_id, telegram_username, referred_by)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', 'Гость'),
    1, 0, 1,
    NULLIF(NEW.raw_user_meta_data->>'telegram_id','')::bigint,
    NEW.raw_user_meta_data->>'telegram_username',
    NULLIF(NEW.raw_user_meta_data->>'referred_by','')::uuid
  )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS _rows = ROW_COUNT;
  IF _rows > 0 THEN
    INSERT INTO balance_events (user_id, delta, reason) VALUES (NEW.id, 1, 'welcome_bonus');
  END IF;
  RETURN NEW;
END;
$$;

-- 1) Публикация подарка: +0.2 балла владельцу.
CREATE OR REPLACE FUNCTION public.award_publish_xp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.owner_id IS NOT NULL THEN
    UPDATE profiles
      SET xp = xp + 20,
          level = public.calc_level(xp + 20),
          balance = balance + 0.2,
          updated_at = now()
      WHERE user_id = NEW.owner_id;
    INSERT INTO balance_events (user_id, delta, reason, gift_id)
      VALUES (NEW.owner_id, 0.2, 'gift_published', NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

-- 2) Бронь подарка: -cost получателю.
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
  INSERT INTO balance_events (user_id, delta, reason, gift_id)
    VALUES (_me, -_cost, 'gift_claimed', _gift_id);
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
REVOKE EXECUTE ON FUNCTION public.claim_gift(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_gift(uuid) TO authenticated;

-- 3) Вручение подтверждено: +0.8 дарителю.
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
  INSERT INTO balance_events (user_id, delta, reason, gift_id)
    VALUES (_tx.sender_id, 0.8, 'gift_handed_over', _tx.gift_id);
END;
$$;

-- 4) Бронь отменена: возврат баллов получателю.
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
  INSERT INTO balance_events (user_id, delta, reason, gift_id)
    VALUES (_tx.receiver_id, _tx.amount, 'gift_claim_cancelled', _tx.gift_id);
END;
$$;

-- 5) Желание исполнено: -cost загадавшему, +cost исполнителю.
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
  INSERT INTO balance_events (user_id, delta, reason, wish_id)
    VALUES (_me, -_wish_cost, 'wish_paid', _tx.wish_id);

  -- исполнитель: +cost баллов, +80 XP
  UPDATE profiles
    SET balance = balance + _wish_cost,
        xp = xp + 80,
        level = public.calc_level(xp + 80),
        updated_at = now()
    WHERE user_id = _tx.giver_id;
  INSERT INTO balance_events (user_id, delta, reason, wish_id)
    VALUES (_tx.giver_id, _wish_cost, 'wish_fulfilled', _tx.wish_id);
END;
$$;
