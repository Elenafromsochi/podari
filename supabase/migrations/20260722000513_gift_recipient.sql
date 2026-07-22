-- Личный подарок конкретному человеку: кому предназначен (для автоуведомления).
ALTER TABLE public.gifts ADD COLUMN IF NOT EXISTS recipient_id UUID;
