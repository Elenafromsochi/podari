# Перенос «Подари» с Cloudflare на сервер Timeweb (работа без VPN)

> **Перед восстановлением существующего проекта:** прочитайте
> [результаты диагностики и порядок восстановления](RECOVERY-2026-09-06.md).
> Ниже — историческая инструкция переноса. На 06.09.2026 публичный DNS
> `23podari.ru` возвращает `31.130.151.178`, а опубликованный фронтенд
> отличается от `main`. IP, пути и настройки ниже требуют проверки на сервере.

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

## Ретранслятор Telegram webhook

Telegram отправляет обновления бота через Cloudflare Worker, а Worker передаёт
их в существующий обработчик на Timeweb. Это обходит нестабильное прямое
соединение Telegram с публичным IP сервера, не меняя бота и логику входа.

- Код Worker: `deploy/telegram-relay-worker.js`.
- Публичный путь Worker: `/telegram/webhook`.
- Проверка доступности: `GET /health`.
- В Worker не хранятся токен бота и секрет webhook. Заголовок
  `X-Telegram-Bot-Api-Secret-Token` передаётся исходному обработчику, который
  по-прежнему проверяет секрет.

## Откат (если что-то пошло не так)
Переключение проксирования Cloudflare не восстанавливает прежний код приложения.
Откат выполняется на сохранённую и проверенную сборку с совместимыми настройками
и схемой БД. Не останавливайте `podari` ради переключения DNS: Cloudflare может
продолжать обращаться к этому же сервису. Сначала установите фактическую схему
публикации и сохраните текущую сборку, конфигурацию, БД и файлы.
