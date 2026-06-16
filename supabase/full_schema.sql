-- ============================================================
-- Полная схема базы данных Podari (все миграции в одном файле)
-- Запусти этот файл целиком в Supabase -> SQL Editor.
-- ============================================================


-- ===== 20260518102824_35fd3cfd-036a-45ff-8ca6-a8c849ff8175.sql =====
-- Profiles
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID UNIQUE,
  display_name TEXT NOT NULL DEFAULT 'Гость',
  balance INTEGER NOT NULL DEFAULT 100,
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_all" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles_insert_self" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

-- Gifts
CREATE TABLE public.gifts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'разное',
  cost INTEGER NOT NULL DEFAULT 50,
  status TEXT NOT NULL DEFAULT 'available',
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.gifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gifts_select_all" ON public.gifts FOR SELECT USING (true);
CREATE POLICY "gifts_insert_owner" ON public.gifts FOR INSERT WITH CHECK (auth.uid() = owner_id OR owner_id IS NULL);
CREATE POLICY "gifts_update_owner" ON public.gifts FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "gifts_delete_owner" ON public.gifts FOR DELETE USING (auth.uid() = owner_id);

-- Transactions
CREATE TABLE public.transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  gift_id UUID REFERENCES public.gifts(id) ON DELETE CASCADE,
  sender_id UUID,
  receiver_id UUID,
  amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tx_select_party" ON public.transactions FOR SELECT USING (auth.uid() IN (sender_id, receiver_id));

-- Chats
CREATE TABLE public.chats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  gift_id UUID REFERENCES public.gifts(id) ON DELETE CASCADE,
  user_a UUID,
  user_b UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chats_select_party" ON public.chats FOR SELECT USING (auth.uid() IN (user_a, user_b));
CREATE POLICY "chats_insert_party" ON public.chats FOR INSERT WITH CHECK (auth.uid() IN (user_a, user_b));

-- Messages
CREATE TABLE public.messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  sender_id UUID,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "messages_select_party" ON public.messages FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.chats c WHERE c.id = chat_id AND auth.uid() IN (c.user_a, c.user_b))
);
CREATE POLICY "messages_insert_party" ON public.messages FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.chats c WHERE c.id = chat_id AND auth.uid() IN (c.user_a, c.user_b))
);

-- Reviews
CREATE TABLE public.reviews (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE CASCADE,
  author_id UUID,
  target_id UUID,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reviews_select_all" ON public.reviews FOR SELECT USING (true);
CREATE POLICY "reviews_insert_author" ON public.reviews FOR INSERT WITH CHECK (auth.uid() = author_id);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER gifts_touch BEFORE UPDATE ON public.gifts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed 5 demo gifts
INSERT INTO public.gifts (title, description, category, cost) VALUES
  ('Книга «Маленький принц»', 'Зачитанная, но любимая. Передам в добрые руки за чашку кофе ✨', 'книги', 40),
  ('Сеанс медитации онлайн', '20 минут вместе в Zoom. Успокоим ум перед сном 🧘', 'медитации', 60),
  ('Кофе с собой ☕', 'Сварю фильтр-кофе у себя дома, заходи в гости в центре города', 'кофе', 30),
  ('Старая гитара', 'Акустика, требует настройки. Для того, кто учится играть 🎸', 'хобби', 80),
  ('Домашние пирожки', 'Испеку партию с капустой или яблоком. Заберёшь горячими 🥟', 'еда', 50);

-- ===== 20260520185026_46403961-a3e9-4dc6-ae72-83d576f44c2c.sql =====
ALTER TABLE public.gifts ALTER COLUMN cost SET DEFAULT 100;
UPDATE public.gifts SET cost = 100 WHERE cost <> 100;

-- ===== 20260520185932_51c5c6f0-1d17-44e1-a14d-003a4ff61bee.sql =====

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


-- ===== 20260520185952_92d92a5b-b57e-407b-88de-d17bee95ef00.sql =====

-- Триггерные функции — никто извне не должен их дёргать
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.award_publish_xp() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.award_review_xp() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;

-- Бизнес-функции — только для авторизованных
REVOKE EXECUTE ON FUNCTION public.claim_gift(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.confirm_handover(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_gift(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_handover(uuid) TO authenticated;

-- calc_level — чистая функция, безвредно
GRANT EXECUTE ON FUNCTION public.calc_level(integer) TO PUBLIC;


-- ===== 20260522123550_86d8b9c2-e6f9-4c2c-b6c3-61cdbd1fc647.sql =====
DELETE FROM public.gifts WHERE owner_id IS NULL;
ALTER TABLE public.gifts ALTER COLUMN owner_id SET NOT NULL;

-- ===== 20260523060348_1dc3d551-774e-4794-a4c8-9727dbd50a76.sql =====
CREATE OR REPLACE FUNCTION public.cancel_claim(_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _me uuid := auth.uid();
  _tx record;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;

  SELECT * INTO _tx FROM transactions WHERE id = _transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TX_NOT_FOUND'; END IF;
  IF _tx.receiver_id <> _me THEN RAISE EXCEPTION 'NOT_RECEIVER'; END IF;
  IF _tx.status <> 'pending' THEN RAISE EXCEPTION 'TX_NOT_PENDING'; END IF;

  UPDATE transactions SET status = 'cancelled' WHERE id = _transaction_id;
  UPDATE gifts SET status = 'available', updated_at = now() WHERE id = _tx.gift_id;

  -- разморозить баллы — вернуть получателю
  UPDATE profiles
    SET balance = balance + _tx.amount,
        updated_at = now()
    WHERE user_id = _tx.receiver_id;
END;
$$;

-- ===== 20260523061551_4617a14b-c467-4f0f-a3a5-b4361d38a380.sql =====

ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.transactions REPLICA IDENTITY FULL;
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;


-- ===== 20260523064015_bf5888ae-d494-42b5-95b9-a54b0c155eda.sql =====

-- Add handover request flag
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS handover_requested_at timestamptz;

-- Sender requests handover confirmation from receiver
CREATE OR REPLACE FUNCTION public.request_handover(_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _me uuid := auth.uid();
  _tx record;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  SELECT * INTO _tx FROM transactions WHERE id = _transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TX_NOT_FOUND'; END IF;
  IF _tx.sender_id <> _me THEN RAISE EXCEPTION 'NOT_SENDER'; END IF;
  IF _tx.status <> 'pending' THEN RAISE EXCEPTION 'TX_NOT_PENDING'; END IF;
  UPDATE transactions SET handover_requested_at = now() WHERE id = _transaction_id;
END;
$$;

-- Receiver declines the handover request (clears flag, stays pending)
CREATE OR REPLACE FUNCTION public.decline_handover(_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _me uuid := auth.uid();
  _tx record;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  SELECT * INTO _tx FROM transactions WHERE id = _transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TX_NOT_FOUND'; END IF;
  IF _tx.receiver_id <> _me THEN RAISE EXCEPTION 'NOT_RECEIVER'; END IF;
  UPDATE transactions SET handover_requested_at = NULL WHERE id = _transaction_id;
END;
$$;

-- Update confirm_handover XP: giver +80 XP, receiver +10 XP (was +20)
CREATE OR REPLACE FUNCTION public.confirm_handover(_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _me uuid := auth.uid();
  _tx record;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  SELECT * INTO _tx FROM transactions WHERE id = _transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TX_NOT_FOUND'; END IF;
  IF _tx.receiver_id <> _me THEN RAISE EXCEPTION 'NOT_RECEIVER'; END IF;
  IF _tx.status <> 'pending' THEN RAISE EXCEPTION 'TX_NOT_PENDING'; END IF;

  UPDATE transactions SET status = 'completed' WHERE id = _transaction_id;
  UPDATE gifts SET status = 'gifted', updated_at = now() WHERE id = _tx.gift_id;

  -- giver: +amount balance, +80 XP
  UPDATE profiles
    SET balance = balance + _tx.amount,
        xp = xp + 80,
        level = public.calc_level(xp + 80),
        updated_at = now()
    WHERE user_id = _tx.sender_id;

  -- receiver: +10 XP (frozen balance стаёт окончательно списанным)
  UPDATE profiles
    SET xp = xp + 10,
        level = public.calc_level(xp + 10),
        updated_at = now()
    WHERE user_id = _tx.receiver_id;
END;
$$;

-- Enable realtime on transactions so receiver gets the request instantly
ALTER TABLE public.transactions REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'transactions'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.transactions';
  END IF;
END $$;


-- ===== 20260524211540_310c2c39-2a26-4fc4-8bc0-3cd6422acbf9.sql =====

-- ===== 1. Wipe demo data =====
TRUNCATE TABLE public.reviews, public.messages, public.transactions, public.chats, public.gifts, public.profiles RESTART IDENTITY CASCADE;
DELETE FROM auth.users;

-- ===== 2. auth_nonces table =====
CREATE TABLE public.auth_nonces (
  nonce text PRIMARY KEY,
  code text,
  telegram_id bigint,
  telegram_username text,
  telegram_first_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  consumed_at timestamptz
);

CREATE INDEX idx_auth_nonces_expires ON public.auth_nonces (expires_at);

ALTER TABLE public.auth_nonces ENABLE ROW LEVEL SECURITY;
-- No policies: access only via service role (server functions).

-- ===== 3. Add telegram_id to profiles for lookup =====
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS telegram_id bigint UNIQUE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS telegram_username text;


-- ===== 20260524220316_dbb88171-a872-40f6-a053-f39d2d3a755d.sql =====

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


-- ===== 20260524222006_024f60fd-4daa-40d3-b1a6-0f939cce83c8.sql =====
CREATE TABLE IF NOT EXISTS public.telegram_referrals (
  telegram_id bigint PRIMARY KEY,
  referred_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.telegram_referrals ENABLE ROW LEVEL SECURITY;

-- ===== 20260525050609_d052b3d2-77ef-4665-89a8-9456ddfe9b97.sql =====

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
    {"code":"first_referral",  "xp":0,  "metric":"referrals", "threshold":1}
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


-- ===== 20260525122031_f8890c8d-b3ad-4f58-845b-00b8d8f12b3c.sql =====
ALTER TABLE public.auth_nonces ADD COLUMN IF NOT EXISTS referrer_id uuid;

-- ===== 20260525123625_34c6ee5c-fbc3-44ea-8e58-77571198d7c0.sql =====

-- 1. Profiles: restrict SELECT to own row, expose safe columns via view
DROP POLICY IF EXISTS profiles_select_all ON public.profiles;

CREATE POLICY profiles_select_own
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS profiles_insert_self ON public.profiles;
CREATE POLICY profiles_insert_self
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Safe public view (display_name, level, xp only)
CREATE OR REPLACE VIEW public.profiles_public
WITH (security_invoker = on) AS
  SELECT user_id, display_name, level, xp, created_at
  FROM public.profiles;

GRANT SELECT ON public.profiles_public TO anon, authenticated;

-- Allow anyone to read the safe view rows
CREATE POLICY profiles_select_public_safe
  ON public.profiles FOR SELECT
  TO anon, authenticated
  USING (true);

-- ^ this would re-open base table. Instead: use a SECURITY DEFINER function for cross-user reads.
DROP POLICY IF EXISTS profiles_select_public_safe ON public.profiles;

-- Helper function: returns safe public profile data for any user (bypasses RLS via SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.get_public_profiles(_user_ids uuid[])
RETURNS TABLE (user_id uuid, display_name text, level int, xp int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id, display_name, level, xp
  FROM public.profiles
  WHERE user_id = ANY(_user_ids);
$$;

REVOKE ALL ON FUNCTION public.get_public_profiles(uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) TO anon, authenticated;

-- 2. Gifts: tighten insert (no NULL owner)
DROP POLICY IF EXISTS gifts_insert_owner ON public.gifts;
CREATE POLICY gifts_insert_owner
  ON public.gifts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = owner_id);

-- 3. Realtime broadcast/presence: deny by default (app only uses postgres_changes, gated by table RLS)
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS realtime_deny_all ON realtime.messages;
CREATE POLICY realtime_deny_all
  ON realtime.messages FOR SELECT
  TO anon, authenticated
  USING (false);

-- 4. auth_nonces & telegram_referrals — explicit deny (service-role only)
DROP POLICY IF EXISTS auth_nonces_deny_all ON public.auth_nonces;
CREATE POLICY auth_nonces_deny_all
  ON public.auth_nonces FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS telegram_referrals_deny_all ON public.telegram_referrals;
CREATE POLICY telegram_referrals_deny_all
  ON public.telegram_referrals FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);


-- ===== 20260525124822_8046057f-4919-4072-9e7b-9a6fdf47f4ef.sql =====

-- 1. user_achievements: owner-only read
DROP POLICY IF EXISTS user_achievements_select_all ON public.user_achievements;
CREATE POLICY user_achievements_select_own ON public.user_achievements
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- 2. reviews: restrict reads to authenticated only (still visible for reputation, hidden from anon)
DROP POLICY IF EXISTS reviews_select_all ON public.reviews;
CREATE POLICY reviews_select_authenticated ON public.reviews
  FOR SELECT TO authenticated USING (true);

-- 3. calc_level: pin search_path
CREATE OR REPLACE FUNCTION public.calc_level(_xp integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _xp >= 1700 THEN 5
    WHEN _xp >= 1000 THEN 4
    WHEN _xp >= 500  THEN 3
    WHEN _xp >= 200  THEN 2
    ELSE 1
  END
$$;

-- 4. Revoke EXECUTE on SECURITY DEFINER functions from anon; keep authenticated where the app needs them
REVOKE EXECUTE ON FUNCTION public.claim_gift(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.confirm_handover(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.request_handover(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.decline_handover(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cancel_claim(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_achievements() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.apply_referral_bonus(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_gift(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_handover(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_handover(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_handover(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_claim(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_achievements() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_profiles(uuid[]) TO authenticated;


-- ===== 20260525125705_83acf11a-3464-456c-9d4a-ad6a9dc9251e.sql =====

-- 1) Profiles: разрешить пользователю менять только display_name
DROP POLICY IF EXISTS profiles_update_self ON public.profiles;

-- Полностью отзываем UPDATE у authenticated на таблице, затем выдаём только на display_name
REVOKE UPDATE ON public.profiles FROM authenticated, anon, public;
GRANT UPDATE (display_name) ON public.profiles TO authenticated;

-- RLS-политика: пользователь может обновлять только свою строку (и только разрешённую колонку — благодаря column GRANT)
CREATE POLICY profiles_update_display_name_self
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 2) Reviews: жёстче проверяем INSERT — нужна реальная транзакция, в которой автор и адресат участвуют
DROP POLICY IF EXISTS reviews_insert_author ON public.reviews;

CREATE POLICY reviews_insert_author
ON public.reviews
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = author_id
  AND transaction_id IS NOT NULL
  AND target_id IS NOT NULL
  AND author_id <> target_id
  AND EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.id = transaction_id
      AND (t.sender_id = auth.uid() OR t.receiver_id = auth.uid())
      AND (t.sender_id = target_id  OR t.receiver_id = target_id)
      AND t.sender_id <> t.receiver_id
  )
);


-- ===== 20260525132023_0234c46a-eefb-40a7-af49-a1800718a7bf.sql =====
DROP POLICY IF EXISTS "realtime_deny_all" ON public.messages;

-- ===== 20260526052205_14d57a03-c5ec-4657-97f0-5a6b0efe7d18.sql =====

-- 1. Flag in profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS password_set boolean NOT NULL DEFAULT false;

-- 2. Trusted devices
CREATE TABLE IF NOT EXISTS public.trusted_devices (
  user_id uuid NOT NULL,
  device_id text NOT NULL,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, device_id)
);

ALTER TABLE public.trusted_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trusted_devices_select_own"
  ON public.trusted_devices FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "trusted_devices_delete_own"
  ON public.trusted_devices FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_user ON public.trusted_devices(user_id);

-- 3. Device login codes (server-only)
CREATE TABLE IF NOT EXISTS public.device_login_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  device_id text NOT NULL,
  code text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.device_login_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "device_login_codes_deny_all"
  ON public.device_login_codes FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_device_login_codes_user ON public.device_login_codes(user_id);

-- 4. Fast lookup by @username
CREATE INDEX IF NOT EXISTS idx_profiles_telegram_username_lower
  ON public.profiles (lower(telegram_username));


-- ===== 20260526052249_4137f364-5677-40a2-91df-d8c057cb1be5.sql =====

ALTER TABLE public.device_login_codes
  ADD COLUMN IF NOT EXISTS pending_access_token text,
  ADD COLUMN IF NOT EXISTS pending_refresh_token text;


-- ===== 20260526135018_7340a2ae-827d-4362-84fd-f06e07525574.sql =====

-- 1. Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_roles_select_own
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- 2. last_seen tracking
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_profiles_last_seen_at ON public.profiles(last_seen_at);

CREATE OR REPLACE FUNCTION public.touch_last_seen()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.profiles
    SET last_seen_at = now()
    WHERE user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.touch_last_seen() TO authenticated;


-- ===== 20260526141449_72abbc3a-d2d6-4dc7-bdf6-1db44c0882df.sql =====

-- 1) wishes table
CREATE TABLE public.wishes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  image_url text,
  category text NOT NULL DEFAULT 'разное',
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wishes TO authenticated;
GRANT ALL ON public.wishes TO service_role;

ALTER TABLE public.wishes ENABLE ROW LEVEL SECURITY;

CREATE POLICY wishes_select_all ON public.wishes
  FOR SELECT TO authenticated USING (true);
CREATE POLICY wishes_insert_owner ON public.wishes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY wishes_update_owner ON public.wishes
  FOR UPDATE TO authenticated USING (auth.uid() = owner_id);
CREATE POLICY wishes_delete_owner ON public.wishes
  FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE TRIGGER wishes_touch_updated_at
  BEFORE UPDATE ON public.wishes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX wishes_status_created_idx ON public.wishes (status, created_at DESC);
CREATE INDEX wishes_owner_idx ON public.wishes (owner_id);

-- 2) wish_transactions
CREATE TABLE public.wish_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wish_id uuid NOT NULL,
  wisher_id uuid NOT NULL,
  giver_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  handover_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.wish_transactions TO authenticated;
GRANT ALL ON public.wish_transactions TO service_role;

ALTER TABLE public.wish_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY wish_tx_select_party ON public.wish_transactions
  FOR SELECT TO authenticated
  USING (auth.uid() = wisher_id OR auth.uid() = giver_id);

-- 3) extend chats for wish-chats
ALTER TABLE public.chats ADD COLUMN wish_id uuid;
CREATE INDEX chats_wish_id_idx ON public.chats (wish_id);

-- 4) RPC: publish_wish
CREATE OR REPLACE FUNCTION public.publish_wish(
  _title text, _description text, _image_url text, _category text
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _balance numeric;
  _wish_id uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  IF coalesce(trim(_title), '') = '' THEN RAISE EXCEPTION 'EMPTY_TITLE'; END IF;

  SELECT balance INTO _balance FROM profiles WHERE user_id = _me FOR UPDATE;
  IF _balance IS NULL THEN RAISE EXCEPTION 'NO_PROFILE'; END IF;
  IF _balance < 0.2 THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;

  UPDATE profiles
    SET balance = balance - 0.2,
        xp = xp + 10,
        level = public.calc_level(xp + 10),
        updated_at = now()
    WHERE user_id = _me;

  INSERT INTO wishes (owner_id, title, description, image_url, category)
  VALUES (_me, _title, NULLIF(_description, ''), NULLIF(_image_url, ''), COALESCE(NULLIF(_category, ''), 'разное'))
  RETURNING id INTO _wish_id;

  RETURN _wish_id;
END;
$$;

-- 5) RPC: fulfill_wish
CREATE OR REPLACE FUNCTION public.fulfill_wish(_wish_id uuid)
RETURNS TABLE(transaction_id uuid, chat_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _owner uuid;
  _status text;
  _tx_id uuid;
  _chat_id uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  SELECT owner_id, status INTO _owner, _status FROM wishes WHERE id = _wish_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'WISH_NOT_FOUND'; END IF;
  IF _status <> 'open' THEN RAISE EXCEPTION 'ALREADY_TAKEN'; END IF;
  IF _owner = _me THEN RAISE EXCEPTION 'OWN_WISH'; END IF;

  UPDATE wishes SET status = 'reserved', updated_at = now() WHERE id = _wish_id;

  INSERT INTO wish_transactions (wish_id, wisher_id, giver_id, status)
  VALUES (_wish_id, _owner, _me, 'pending') RETURNING id INTO _tx_id;

  SELECT id INTO _chat_id FROM chats
    WHERE wish_id = _wish_id
      AND ((user_a = _owner AND user_b = _me) OR (user_a = _me AND user_b = _owner))
    LIMIT 1;
  IF _chat_id IS NULL THEN
    INSERT INTO chats (wish_id, user_a, user_b) VALUES (_wish_id, _owner, _me)
    RETURNING id INTO _chat_id;
  END IF;

  RETURN QUERY SELECT _tx_id, _chat_id;
END;
$$;

-- 6) RPC: request_wish_handover (giver says "delivered")
CREATE OR REPLACE FUNCTION public.request_wish_handover(_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _me uuid := auth.uid(); _tx record;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  SELECT * INTO _tx FROM wish_transactions WHERE id = _transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TX_NOT_FOUND'; END IF;
  IF _tx.giver_id <> _me THEN RAISE EXCEPTION 'NOT_GIVER'; END IF;
  IF _tx.status <> 'pending' THEN RAISE EXCEPTION 'TX_NOT_PENDING'; END IF;
  UPDATE wish_transactions SET handover_requested_at = now() WHERE id = _transaction_id;
END;
$$;

-- 7) RPC: confirm_wish_received (wisher confirms)
CREATE OR REPLACE FUNCTION public.confirm_wish_received(_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _tx record;
  _wisher_balance numeric;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  SELECT * INTO _tx FROM wish_transactions WHERE id = _transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TX_NOT_FOUND'; END IF;
  IF _tx.wisher_id <> _me THEN RAISE EXCEPTION 'NOT_WISHER'; END IF;
  IF _tx.status <> 'pending' THEN RAISE EXCEPTION 'TX_NOT_PENDING'; END IF;

  SELECT balance INTO _wisher_balance FROM profiles WHERE user_id = _me FOR UPDATE;
  IF _wisher_balance IS NULL THEN RAISE EXCEPTION 'NO_PROFILE'; END IF;
  IF _wisher_balance < 0.8 THEN RAISE EXCEPTION 'INSUFFICIENT_BALANCE'; END IF;

  UPDATE wish_transactions SET status = 'completed' WHERE id = _transaction_id;
  UPDATE wishes SET status = 'fulfilled', updated_at = now() WHERE id = _tx.wish_id;

  -- wisher: -0.8 balance, +10 XP
  UPDATE profiles
    SET balance = balance - 0.8,
        xp = xp + 10,
        level = public.calc_level(xp + 10),
        updated_at = now()
    WHERE user_id = _me;

  -- giver: +1 balance, +80 XP
  UPDATE profiles
    SET balance = balance + 1,
        xp = xp + 80,
        level = public.calc_level(xp + 80),
        updated_at = now()
    WHERE user_id = _tx.giver_id;
END;
$$;

-- 8) RPC: cancel_wish_claim (wisher cancels reservation)
CREATE OR REPLACE FUNCTION public.cancel_wish_claim(_transaction_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _me uuid := auth.uid(); _tx record;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  SELECT * INTO _tx FROM wish_transactions WHERE id = _transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TX_NOT_FOUND'; END IF;
  IF _tx.wisher_id <> _me AND _tx.giver_id <> _me THEN RAISE EXCEPTION 'NOT_PARTY'; END IF;
  IF _tx.status <> 'pending' THEN RAISE EXCEPTION 'TX_NOT_PENDING'; END IF;
  UPDATE wish_transactions SET status = 'cancelled' WHERE id = _transaction_id;
  UPDATE wishes SET status = 'open', updated_at = now() WHERE id = _tx.wish_id;
END;
$$;


-- ===== 20260526143220_1c8115ab-f5dd-4c63-9d46-03233b4c305d.sql =====

-- 1. Replace the blanket deny policy on realtime.messages with scoped policies.
DROP POLICY IF EXISTS realtime_deny_all ON realtime.messages;

-- Allow authenticated users to subscribe to Realtime topics they participate in.
-- Topic convention used in app code: messages-<chat_id>, tx-<transaction_id>, global-tx-<user_id>, global-msgs-<user_id>.
CREATE POLICY "realtime_authenticated_scoped_read"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  -- chat-scoped topics: messages-<chat_id>
  (
    realtime.topic() LIKE 'messages-%'
    AND EXISTS (
      SELECT 1 FROM public.chats c
      WHERE c.id::text = substring(realtime.topic() from 'messages-(.*)')
        AND (c.user_a = auth.uid() OR c.user_b = auth.uid())
    )
  )
  OR
  -- transaction-scoped topics: tx-<transaction_id>
  (
    realtime.topic() LIKE 'tx-%'
    AND EXISTS (
      SELECT 1 FROM public.transactions t
      WHERE t.id::text = substring(realtime.topic() from 'tx-(.*)')
        AND (t.sender_id = auth.uid() OR t.receiver_id = auth.uid())
    )
  )
  OR
  -- per-user notification topics: global-tx-<uid> / global-msgs-<uid>
  (
    realtime.topic() = 'global-tx-' || auth.uid()::text
    OR realtime.topic() = 'global-msgs-' || auth.uid()::text
  )
);

-- 2. Document the intentional public visibility of the wishes feed.
COMMENT ON POLICY wishes_select_all ON public.wishes IS
  'Intentional: the wishes feed is a public marketplace — any authenticated user must see all open wishes to be able to fulfill them. Personal data should not be put in wishes.';


-- ===== 20260530142140_610b82d9-6338-4568-94cf-eec4096369ee.sql =====
ALTER TABLE public.auth_nonces
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz;

-- ===== 20260602044655_04a1e6e5-135f-4c83-bf26-0aafa3c61399.sql =====
CREATE OR REPLACE FUNCTION public.cancel_by_sender(_transaction_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _me uuid := auth.uid(); _tx record;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  SELECT * INTO _tx FROM transactions WHERE id = _transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TX_NOT_FOUND'; END IF;
  IF _tx.sender_id <> _me THEN RAISE EXCEPTION 'NOT_SENDER'; END IF;
  IF _tx.status <> 'pending' THEN RAISE EXCEPTION 'TX_NOT_PENDING'; END IF;
  UPDATE transactions SET status = 'cancelled' WHERE id = _transaction_id;
  UPDATE gifts SET status = 'available', updated_at = now() WHERE id = _tx.gift_id;
  -- возвращаем замороженные баллы получателю
  UPDATE profiles SET balance = balance + _tx.amount, updated_at = now() WHERE user_id = _tx.receiver_id;
END;
$function$;

-- ===== 20260602081235_71160a92-e182-47de-ad6a-71432977e2c1.sql =====
ALTER TABLE public.gifts
  ADD COLUMN IF NOT EXISTS cost_flag boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_gifts_cost_flag ON public.gifts (cost_flag) WHERE cost_flag = true;
CREATE INDEX IF NOT EXISTS idx_gifts_kind_category ON public.gifts (gift_kind, category);

-- ===== 20260602222813_58bf427c-2d85-4c09-81e7-ad3199e23c6e.sql =====

-- Таблица сообщений админу
CREATE TABLE public.admin_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  content text NOT NULL,
  image_path text,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_admin_messages_status_created ON public.admin_messages (status, created_at DESC);

GRANT SELECT, INSERT ON public.admin_messages TO authenticated;
GRANT ALL ON public.admin_messages TO service_role;

ALTER TABLE public.admin_messages ENABLE ROW LEVEL SECURITY;

-- Пользователь может вставлять свои сообщения
CREATE POLICY "admin_messages_insert_own"
ON public.admin_messages FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND length(content) BETWEEN 1 AND 4000);

-- Пользователь может видеть только свои сообщения; админ — все
CREATE POLICY "admin_messages_select_own_or_admin"
ON public.admin_messages FOR SELECT TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

-- Только админ может обновлять статус
CREATE POLICY "admin_messages_update_admin"
ON public.admin_messages FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Политики на storage.objects для bucket 'admin-uploads'
-- Пользователь грузит в свою папку <user_id>/...
CREATE POLICY "admin_uploads_insert_own"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'admin-uploads'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Пользователь видит свои файлы, админ — все
CREATE POLICY "admin_uploads_select_own_or_admin"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'admin-uploads'
  AND (auth.uid()::text = (storage.foldername(name))[1] OR public.has_role(auth.uid(), 'admin'))
);


-- ===== 20260603031242_fef6c7d4-64a2-4286-a3a5-fdf3e8ae928b.sql =====
ALTER TABLE public.gifts  ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.wishes ADD COLUMN IF NOT EXISTS image_urls text[] NOT NULL DEFAULT '{}'::text[];

-- ===== 20260607183140_b451e590-0db1-4b7a-a4ca-83cca16d7099.sql =====
-- 1) Remove gifts/chats from realtime publication (no client subscribes to them)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'gifts'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.gifts';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chats'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.chats';
  END IF;
END $$;

-- 2) Admin-only UPDATE/DELETE on admin-uploads bucket
DROP POLICY IF EXISTS "admin_uploads_update_admin" ON storage.objects;
CREATE POLICY "admin_uploads_update_admin"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'admin-uploads' AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (bucket_id = 'admin-uploads' AND public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "admin_uploads_delete_admin" ON storage.objects;
CREATE POLICY "admin_uploads_delete_admin"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'admin-uploads' AND public.has_role(auth.uid(), 'admin'::public.app_role));

-- ===== 20260607183213_a12460c1-e5a8-46e8-95fe-d5889febbdd0.sql =====
-- Public read of gift images (matches public readability of public.gifts)
DROP POLICY IF EXISTS "gift_images_read_public" ON storage.objects;
CREATE POLICY "gift_images_read_public"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'gift-images');

-- Authenticated users upload into their own folder: <auth.uid()>/<file>
DROP POLICY IF EXISTS "gift_images_insert_own" ON storage.objects;
CREATE POLICY "gift_images_insert_own"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'gift-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "gift_images_update_own" ON storage.objects;
CREATE POLICY "gift_images_update_own"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'gift-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'gift-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "gift_images_delete_own" ON storage.objects;
CREATE POLICY "gift_images_delete_own"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'gift-images'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- ===== Оценка состояния подарка (1-5 сердечек) =====
ALTER TABLE public.gifts ADD COLUMN IF NOT EXISTS condition smallint;

-- ===== Проверка состояния получателем (отзыв) =====
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS condition_confirmed smallint;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS proof_image_url text;

-- ===== Надёжный реферальный бонус через триггер =====
CREATE OR REPLACE FUNCTION public.handle_referral_bonus()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.referred_by IS NOT NULL
     AND NEW.referred_by <> NEW.user_id
     AND (TG_OP = 'INSERT' OR OLD.referred_by IS DISTINCT FROM NEW.referred_by) THEN
    UPDATE public.profiles
      SET xp = xp + 50, level = public.calc_level(xp + 50), updated_at = now()
      WHERE user_id = NEW.referred_by;
    UPDATE public.profiles
      SET balance = balance + 1, updated_at = now()
      WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_referral_bonus ON public.profiles;
CREATE TRIGGER trg_referral_bonus
  AFTER INSERT OR UPDATE OF referred_by ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_referral_bonus();
