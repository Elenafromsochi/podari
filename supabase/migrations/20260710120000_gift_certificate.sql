-- Подарочный сертификат: подарок можно превратить в именной сертификат по
-- ссылке (обложка = готовая картинка-сертификат, подарок становится скрытым).
-- Эти поля включают «режим сертификата» на странице и срок действия.
ALTER TABLE public.gifts
  ADD COLUMN IF NOT EXISTS is_certificate boolean NOT NULL DEFAULT false;
ALTER TABLE public.gifts
  ADD COLUMN IF NOT EXISTS cert_expires_at timestamptz;
