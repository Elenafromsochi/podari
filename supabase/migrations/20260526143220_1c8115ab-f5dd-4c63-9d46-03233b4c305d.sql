
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
