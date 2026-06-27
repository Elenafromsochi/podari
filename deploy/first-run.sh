#!/usr/bin/env bash
#
# Первый запуск сайта «Подари» на сервере Timeweb (без Cloudflare).
# Проверяет окружение, создаёт .env (ключи Supabase подставляются сами),
# собирает фронтенд под Node, поднимает systemd-сервис и Caddy.
# После него остаётся только переключить DNS на сервер (см. конец вывода).
#
# Запуск:  cd /opt/podari && git pull && sudo bash deploy/first-run.sh
#
set -uo pipefail
APP_DIR="/opt/podari"
cd "$APP_DIR" || { echo "Нет $APP_DIR"; exit 1; }

step() { echo; echo "===== $* ====="; }

step "0/6  Проверяю окружение"
if ! command -v node >/dev/null 2>&1; then
  echo "✗ Node.js не установлен. Поставь Node 20+ и повтори."
  echo "  Debian/Ubuntu:  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs"
  exit 1
fi
NODE_MAJOR="$(node -v | sed 's/^v//; s/\..*//')"
echo "  node $(node -v)"
[ "${NODE_MAJOR:-0}" -ge 20 ] || { echo "✗ Нужен Node 20+. Сейчас $(node -v)."; exit 1; }
if ! command -v caddy >/dev/null 2>&1; then
  echo "✗ Caddy не установлен. Поставь и повтори:"
  echo "  apt install -y debian-keyring debian-archive-keyring apt-transport-https curl"
  echo "  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg"
  echo "  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list"
  echo "  apt update && apt install -y caddy"
  exit 1
fi
echo "  caddy $(caddy version | head -1)"

step "1/6  Готовлю .env (ключи Supabase — автоматически)"
bash deploy/make-env.sh || exit 1

step "2/6  Ставлю зависимости (npm install)"
npm install || { echo "✗ npm install не прошёл"; exit 1; }

step "3/6  Собираю фронтенд под Node-сервер"
NITRO_PRESET=node-server npm run build || { echo "✗ сборка не прошла"; exit 1; }
[ -f dist/server/index.mjs ] || { echo "✗ нет dist/server/index.mjs — сборка неполная"; exit 1; }

step "4/6  Поднимаю systemd-сервис podari"
cp deploy/podari.service /etc/systemd/system/podari.service
systemctl daemon-reload
systemctl enable podari
# restart (а не просто start) — чтобы уже запущенный сервис подхватил свежую сборку.
systemctl restart podari
sleep 2
systemctl --no-pager status podari | head -6 || true

step "5/6  Проверяю, что сервер отвечает локально"
code="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000 || echo 000)"
echo "  http://127.0.0.1:3000 -> $code"
[ "$code" != "000" ] || { echo "✗ сервис не отвечает — смотри логи: journalctl -u podari -n 40 --no-pager"; exit 1; }

step "6/6  Настраиваю Caddy (сайт + API + SSL)"
cp deploy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy 2>/dev/null || systemctl restart caddy
echo "  Caddy перезапущен."

echo
echo "============================================================"
echo "Сервер готов. ОСТАЛСЯ ОДИН ШАГ — переключить DNS на сервер:"
echo
echo "  В Cloudflare (DNS) для 23podari.ru, www.23podari.ru и api.23podari.ru:"
echo "  • либо переключи «оранжевое облако» → серое (DNS only),"
echo "  • либо поставь A-запись → 5.42.111.169"
echo
echo "Через 1–2 минуты Caddy сам выпустит SSL, и сайт откроется БЕЗ VPN."
echo "Проверка после DNS:  curl -I https://23podari.ru"
echo "============================================================"
