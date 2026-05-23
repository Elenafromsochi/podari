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