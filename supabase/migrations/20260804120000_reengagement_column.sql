-- Метка последней автоматической «возвращающей» рассылки уснувшему
-- пользователю — чтобы не слать нудж каждый прогон подряд.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_reengagement_sent_at TIMESTAMPTZ;
