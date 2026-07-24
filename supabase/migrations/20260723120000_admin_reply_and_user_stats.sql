-- Ответ админа на сообщение пользователя: текст ответа + время, чтобы видеть
-- историю переписки прямо в админке.
ALTER TABLE public.admin_messages ADD COLUMN IF NOT EXISTS admin_reply text;
ALTER TABLE public.admin_messages ADD COLUMN IF NOT EXISTS replied_at timestamptz;

-- Статистика по каждому пользователю (сколько подарков опубликовал/подарил/
-- получил, сколько друзей привёл) — нужна, чтобы фильтровать аудиторию
-- рассылки в админке (например «ни разу не дарили» или «привели друзей»).
CREATE OR REPLACE VIEW public.admin_user_stats AS
SELECT
  p.user_id,
  p.display_name,
  p.telegram_username,
  p.telegram_id,
  p.level,
  p.xp,
  p.balance,
  p.last_seen_at,
  p.created_at,
  COALESCE(posted.n, 0) AS gifts_posted,
  COALESCE(given.n, 0) AS gifts_given,
  COALESCE(received.n, 0) AS gifts_received,
  COALESCE(refs.n, 0) AS referrals_count
FROM public.profiles p
LEFT JOIN (
  SELECT owner_id, COUNT(*) AS n FROM public.gifts GROUP BY owner_id
) posted ON posted.owner_id = p.user_id
LEFT JOIN (
  SELECT sender_id, COUNT(*) AS n FROM public.transactions WHERE status = 'completed' GROUP BY sender_id
) given ON given.sender_id = p.user_id
LEFT JOIN (
  SELECT receiver_id, COUNT(*) AS n FROM public.transactions WHERE status = 'completed' GROUP BY receiver_id
) received ON received.receiver_id = p.user_id
LEFT JOIN (
  SELECT referred_by, COUNT(*) AS n FROM public.profiles WHERE referred_by IS NOT NULL GROUP BY referred_by
) refs ON refs.referred_by = p.user_id;

GRANT SELECT ON public.admin_user_stats TO service_role;
