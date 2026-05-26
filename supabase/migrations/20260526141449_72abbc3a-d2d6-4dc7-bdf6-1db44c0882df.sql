
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
