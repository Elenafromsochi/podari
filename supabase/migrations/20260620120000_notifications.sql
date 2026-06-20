-- Уведомления: переключатель «получать уведомления в Telegram».
-- По умолчанию включено. Код устойчив к ситуации, когда миграция ещё не применена.
alter table public.profiles
  add column if not exists notifications_enabled boolean not null default true;
