
-- 1. Триггер на создание profile при регистрации
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name, balance, xp, level)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', 'Гость'),
    100,
    0,
    1
  )
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Хелпер для уровня
CREATE OR REPLACE FUNCTION public.calc_level(_xp integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$ SELECT GREATEST(1, (_xp / 200) + 1) $$;

-- 3. claim_gift: получатель забирает подарок
CREATE OR REPLACE FUNCTION public.claim_gift(_gift_id uuid)
RETURNS TABLE(transaction_id uuid, chat_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _owner uuid;
  _cost integer;
  _status text;
  _balance integer;
  _tx_id uuid;
  _chat_id uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;

  SELECT owner_id, cost, status INTO _owner, _cost, _status
  FROM gifts WHERE id = _gift_id FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'GIFT_NOT_FOUND'; END IF;
  IF _status <> 'available' THEN RAISE EXCEPTION 'ALREADY_TAKEN'; END IF;
  IF _owner = _me THEN RAISE EXCEPTION 'OWN_GIFT'; END IF;
  IF _owner IS NULL THEN RAISE EXCEPTION 'NO_OWNER'; END IF;

  SELECT balance INTO _balance FROM profiles WHERE user_id = _me FOR UPDATE;
  IF _balance IS NULL THEN RAISE EXCEPTION 'NO_PROFILE'; END IF;
  IF _balance < _cost THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;

  -- заморозить (списать) у получателя
  UPDATE profiles SET balance = balance - _cost, updated_at = now()
    WHERE user_id = _me;

  -- зарезервировать подарок
  UPDATE gifts SET status = 'reserved', updated_at = now()
    WHERE id = _gift_id;

  -- создать сделку
  INSERT INTO transactions (gift_id, sender_id, receiver_id, amount, status)
  VALUES (_gift_id, _owner, _me, _cost, 'pending')
  RETURNING id INTO _tx_id;

  -- создать чат (или найти существующий)
  SELECT id INTO _chat_id FROM chats
    WHERE gift_id = _gift_id
      AND ((user_a = _owner AND user_b = _me) OR (user_a = _me AND user_b = _owner))
    LIMIT 1;

  IF _chat_id IS NULL THEN
    INSERT INTO chats (gift_id, user_a, user_b)
    VALUES (_gift_id, _owner, _me)
    RETURNING id INTO _chat_id;
  END IF;

  RETURN QUERY SELECT _tx_id, _chat_id;
END;
$$;

-- 4. confirm_handover: получатель подтверждает вручение
CREATE OR REPLACE FUNCTION public.confirm_handover(_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _tx record;
  _giver_xp integer;
  _receiver_xp integer;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;

  SELECT * INTO _tx FROM transactions WHERE id = _transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TX_NOT_FOUND'; END IF;
  IF _tx.receiver_id <> _me THEN RAISE EXCEPTION 'NOT_RECEIVER'; END IF;
  IF _tx.status <> 'pending' THEN RAISE EXCEPTION 'TX_NOT_PENDING'; END IF;

  UPDATE transactions SET status = 'completed' WHERE id = _transaction_id;
  UPDATE gifts SET status = 'gifted', updated_at = now() WHERE id = _tx.gift_id;

  -- замороженные баллы переводятся дарителю
  UPDATE profiles
    SET balance = balance + _tx.amount,
        xp = xp + 80,
        level = public.calc_level(xp + 80),
        updated_at = now()
    WHERE user_id = _tx.sender_id;

  UPDATE profiles
    SET xp = xp + 20,
        level = public.calc_level(xp + 20),
        updated_at = now()
    WHERE user_id = _tx.receiver_id;
END;
$$;

-- 5. Начисление XP за публикацию (вызывается после insert в gifts)
CREATE OR REPLACE FUNCTION public.award_publish_xp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.owner_id IS NOT NULL THEN
    UPDATE profiles
      SET xp = xp + 20,
          level = public.calc_level(xp + 20),
          updated_at = now()
      WHERE user_id = NEW.owner_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS gifts_award_publish_xp ON public.gifts;
CREATE TRIGGER gifts_award_publish_xp
  AFTER INSERT ON public.gifts
  FOR EACH ROW EXECUTE FUNCTION public.award_publish_xp();

-- 6. Начисление XP за отзыв
CREATE OR REPLACE FUNCTION public.award_review_xp()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.author_id IS NOT NULL THEN
    UPDATE profiles
      SET xp = xp + 20,
          level = public.calc_level(xp + 20),
          updated_at = now()
      WHERE user_id = NEW.author_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reviews_award_xp ON public.reviews;
CREATE TRIGGER reviews_award_xp
  AFTER INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.award_review_xp();

-- 7. Realtime
ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.chats REPLICA IDENTITY FULL;
ALTER TABLE public.gifts REPLICA IDENTITY FULL;
ALTER TABLE public.transactions REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chats;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.gifts;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
  EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- 8. Индексы
CREATE INDEX IF NOT EXISTS profiles_user_id_idx ON public.profiles(user_id);
CREATE INDEX IF NOT EXISTS gifts_owner_id_idx ON public.gifts(owner_id);
CREATE INDEX IF NOT EXISTS gifts_status_idx ON public.gifts(status);
CREATE INDEX IF NOT EXISTS transactions_sender_idx ON public.transactions(sender_id);
CREATE INDEX IF NOT EXISTS transactions_receiver_idx ON public.transactions(receiver_id);

-- 9. триггер updated_at на gifts
DROP TRIGGER IF EXISTS gifts_touch_updated_at ON public.gifts;
CREATE TRIGGER gifts_touch_updated_at
  BEFORE UPDATE ON public.gifts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS profiles_touch_updated_at ON public.profiles;
CREATE TRIGGER profiles_touch_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
