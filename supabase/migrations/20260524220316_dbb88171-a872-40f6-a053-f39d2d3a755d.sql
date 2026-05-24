
DELETE FROM public.reviews;
DELETE FROM public.messages;
DELETE FROM public.chats;
DELETE FROM public.transactions;
DELETE FROM public.gifts;

ALTER TABLE public.profiles ALTER COLUMN balance DROP DEFAULT;
ALTER TABLE public.profiles ALTER COLUMN balance TYPE numeric(10,2) USING (CASE WHEN balance >= 100 THEN 1 ELSE balance::numeric END);
ALTER TABLE public.profiles ALTER COLUMN balance SET DEFAULT 1;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referred_by uuid;

ALTER TABLE public.gifts ALTER COLUMN cost DROP DEFAULT;
ALTER TABLE public.gifts ALTER COLUMN cost TYPE numeric(10,2) USING 1;
ALTER TABLE public.gifts ALTER COLUMN cost SET DEFAULT 1;
ALTER TABLE public.gifts
  ADD COLUMN IF NOT EXISTS gift_kind text NOT NULL DEFAULT 'used_item',
  ADD COLUMN IF NOT EXISTS price_rub integer,
  ADD COLUMN IF NOT EXISTS price_tier text NOT NULL DEFAULT 'under_3k';

CREATE OR REPLACE FUNCTION public.calc_level(_xp integer)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _xp >= 1700 THEN 5
    WHEN _xp >= 1000 THEN 4
    WHEN _xp >= 500  THEN 3
    WHEN _xp >= 200  THEN 2
    ELSE 1
  END
$$;

UPDATE public.profiles SET level = public.calc_level(xp);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
  RETURN NEW;
END;
$$;

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
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_award_publish_xp ON public.gifts;
CREATE TRIGGER trg_award_publish_xp
  AFTER INSERT ON public.gifts
  FOR EACH ROW EXECUTE FUNCTION public.award_publish_xp();

ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS is_auto boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.award_review_xp()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _xp integer;
BEGIN
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

DROP TRIGGER IF EXISTS trg_award_review_xp ON public.reviews;
CREATE TRIGGER trg_award_review_xp
  AFTER INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.award_review_xp();

CREATE OR REPLACE FUNCTION public.claim_gift(_gift_id uuid)
RETURNS TABLE(transaction_id uuid, chat_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _me uuid := auth.uid();
  _owner uuid;
  _cost numeric;
  _status text;
  _balance numeric;
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
  UPDATE profiles
    SET balance = balance - _cost,
        xp = xp + 10,
        level = public.calc_level(xp + 10),
        updated_at = now()
    WHERE user_id = _me;
  UPDATE gifts SET status = 'reserved', updated_at = now() WHERE id = _gift_id;
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
  RETURN QUERY SELECT _tx_id, _chat_id;
END;
$$;

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
  UPDATE gifts SET status = 'gifted', updated_at = now() WHERE id = _tx.gift_id;
  UPDATE profiles
    SET balance = balance + 0.8,
        xp = xp + 80,
        level = public.calc_level(xp + 80),
        updated_at = now()
    WHERE user_id = _tx.sender_id;
END;
$$;

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
  UPDATE gifts SET status = 'available', updated_at = now() WHERE id = _tx.gift_id;
  UPDATE profiles SET balance = balance + _tx.amount, updated_at = now() WHERE user_id = _tx.receiver_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_referral_bonus(_new_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _ref uuid;
BEGIN
  SELECT referred_by INTO _ref FROM profiles WHERE user_id = _new_user;
  IF _ref IS NULL OR _ref = _new_user THEN RETURN; END IF;
  UPDATE profiles
    SET xp = xp + 50, level = public.calc_level(xp + 50), updated_at = now()
    WHERE user_id = _ref;
  UPDATE profiles
    SET balance = balance + 1, updated_at = now()
    WHERE user_id = _new_user;
END;
$$;
