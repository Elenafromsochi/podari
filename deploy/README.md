# Перенос «Подари» с Cloudflare на сервер Timeweb (работа без VPN)

Цель: сайт `23podari.ru` и API `api.23podari.ru` отдаются **напрямую с вашего
российского сервера** (`5.42.111.169`), без Cloudflare — тогда сайт открывается
в России без VPN. Вход остаётся двойной: с VPN — Telegram, без VPN — VK.

Данные уже на сервере (self-hosted Supabase, `/opt/supabase`), переносить базу
не нужно. Здесь только поднимаем фронтенд на том же сервере и убираем Cloudflare
с пути.

> Все команды — из-под root на сервере (`ssh root@5.42.111.169`).
> Node.js нужен версии **20+** (`node -v`). Если нет — поставить перед началом.

---

## Шаг 1. Скачать код приложения на сервер

```bash
git clone https://github.com/Elenafromsochi/podari.git /opt/podari
cd /opt/podari
```

## Шаг 2. Прописать секреты

```bash
cp /opt/podari/deploy/.env.example /opt/podari/.env
cat /root/supabase-secrets.txt        # отсюда взять anon key и service_role key
nano /opt/podari/.env                 # подставить реальные значения
```
Заполни все строки `ЗАМЕНИ_...`. Telegram-токен, секрет вебхука и ключ
`proxyapi` возьми из текущих настроек проекта в Cloudflare (Settings → Variables).

## Шаг 3. Собрать и запустить приложение (Node-сервис)

```bash
cd /opt/podari
npm install
NITRO_PRESET=node-server npm run build

cp deploy/podari.service /etc/systemd/system/podari.service
systemctl daemon-reload
systemctl enable --now podari
curl -I http://127.0.0.1:3000          # должен ответить сервер (200/3xx)
```

## Шаг 4. Настроить Caddy (сайт + API + SSL)

```bash
cp /opt/podari/deploy/Caddyfile /etc/caddy/Caddyfile
systemctl restart caddy
```

## Шаг 5. Увести домены с Cloudflare на сервер

В панели Cloudflare (DNS) для записей `23podari.ru`, `www`, `api.23podari.ru`:
- переключить «оранжевое облако» → **серое (DNS only)**, либо
- задать A-запись → `5.42.111.169`.

После смены DNS Caddy сам выпустит сертификаты (подожди ~1–2 минуты), и сайт
начнёт открываться **без VPN**.

## Шаг 6. Обновить домен в настройках VK ID

В кабинете VK ID (App ID `54650519`) убедиться, что доверенный redirect —
`https://23podari.ru`. Тогда кнопка «Войти через VK» работает без VPN.

---

## Обновление в будущем
После новых изменений в коде — просто:
```bash
sudo bash /opt/podari/deploy/deploy.sh
```

## Откат (если что-то пошло не так)
Вернуть в Cloudflare «оранжевое облако» для доменов — трафик снова пойдёт через
Cloudflare, как раньше. Сервис на сервере при этом можно остановить:
`systemctl stop podari`.
