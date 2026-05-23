
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
