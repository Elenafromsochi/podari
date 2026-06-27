#!/usr/bin/env bash
#
# Создаёт /opt/podari/.env для self-hosted сайта. Ключи Supabase (anon и
# service_role) берёт АВТОМАТИЧЕСКИ из /opt/supabase/.env — печатать их руками
# не нужно. Остаются лишь 3 секрета из Cloudflare (токен бота, секрет вебхука,
# ключ proxyapi). Если .env уже есть — ранее вписанные секреты сохраняются.
#
# Запуск:  bash /opt/podari/deploy/make-env.sh
#
set -uo pipefail

SUPADIR="/opt/supabase"
APPENV="/opt/podari/.env"

ANON="$(grep -m1 '^ANON_KEY=' "$SUPADIR/.env" | cut -d= -f2-)"
SERVICE="$(grep -m1 '^SERVICE_ROLE_KEY=' "$SUPADIR/.env" | cut -d= -f2-)"
[ -n "$ANON" ] && [ -n "$SERVICE" ] || {
  echo "Не нашёл ANON_KEY / SERVICE_ROLE_KEY в $SUPADIR/.env"; exit 1; }

# Сохраняем уже вписанные секреты, чтобы повторный запуск их не затёр.
old() { [ -f "$APPENV" ] && grep -m1 "^$1=" "$APPENV" | cut -d= -f2- || true; }
TG_TOKEN="$(old TELEGRAM_BOT_TOKEN)";    TG_TOKEN="${TG_TOKEN:-ЗАМЕНИ_токен_бота}"
TG_SECRET="$(old TELEGRAM_WEBHOOK_SECRET)"; TG_SECRET="${TG_SECRET:-ЗАМЕНИ_секрет_вебхука}"
AI_KEY="$(old AI_API_KEY)";              AI_KEY="${AI_KEY:-ЗАМЕНИ_ключ_proxyapi}"

cat > "$APPENV" <<EOF
# Сборка фронтенда (адрес и anon-ключ ВАШЕГО Supabase на сервере)
VITE_SUPABASE_URL=https://api.23podari.ru
VITE_SUPABASE_PUBLISHABLE_KEY=$ANON

# Сервер: Supabase
SUPABASE_URL=https://api.23podari.ru
SUPABASE_PUBLISHABLE_KEY=$ANON
SUPABASE_SERVICE_ROLE_KEY=$SERVICE

# Сервер: общее
APP_URL=https://23podari.ru

# Telegram-бот (из настроек Cloudflare)
TELEGRAM_BOT_TOKEN=$TG_TOKEN
TELEGRAM_BOT_USERNAME=Podari_podarki_bot
TELEGRAM_WEBHOOK_SECRET=$TG_SECRET

# ИИ через российский proxyapi.ru (ключ — из настроек Cloudflare)
AI_BASE_URL=https://api.proxyapi.ru/openai/v1
AI_API_KEY=$AI_KEY
AI_MODEL=gpt-4o-mini
AI_IMAGE_MODEL=gpt-image-1
AI_TRANSCRIBE_MODEL=whisper-1

# Node-сервер
PORT=3000
HOST=127.0.0.1
EOF

echo "Готово: создан $APPENV"
echo "Ключи Supabase подставлены автоматически из $SUPADIR/.env"
echo
if grep -q 'ЗАМЕНИ' "$APPENV"; then
  echo "Осталось вписать значения из Cloudflare (Settings → Variables):"
  grep -n 'ЗАМЕНИ' "$APPENV"
  echo
  echo "Открой редактор:   nano $APPENV"
  echo "Сайт и вход через VK заработают и без них; Telegram-вход и ИИ — после того,"
  echo "как впишешь эти 3 строки и перезапустишь сервис (systemctl restart podari)."
else
  echo "Все секреты на месте ✅"
fi
