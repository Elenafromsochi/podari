-- Раньше миграция 20260525125705 отозвала право UPDATE на profiles у
-- authenticated и выдала его обратно только на колонку display_name — это
-- было ДО того, как появились колонки avatar_url/about (миграция
-- 20260720090827). В итоге даже после добавления этих колонок обычный
-- пользователь не мог сохранить свою фотографию или «о себе» — запрос
-- на обновление молча падал по правам доступа.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS about TEXT;
GRANT UPDATE (avatar_url, about) ON public.profiles TO authenticated;
