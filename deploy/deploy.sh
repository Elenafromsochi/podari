#!/usr/bin/env bash
#
# Деплой/обновление приложения «Подари» на сервере Timeweb.
# Тянет свежий код, собирает под Node и перезапускает сервис.
#
# Первый запуск: см. deploy/README.md (клонирование, .env, Caddy, systemd).
# Повторный запуск (обновить прод):  sudo bash /opt/podari/deploy/deploy.sh
#
set -euo pipefail

APP_DIR="/opt/podari"
BRANCH="${1:-main}"

cd "$APP_DIR"

echo "==> 1/4  Забираю свежий код ($BRANCH)"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull origin "$BRANCH"

echo "==> 2/4  Ставлю зависимости"
npm install

echo "==> 3/4  Собираю под Node-сервер"
# .env с VITE_*-переменными подхватится Vite автоматически (из $APP_DIR/.env)
NITRO_PRESET=node-server npm run build

echo "==> 4/4  Перезапускаю сервис"
systemctl restart podari
sleep 2
systemctl status podari --no-pager | head -6

echo ""
echo "Готово. Проверь: curl -I http://127.0.0.1:3000  (должен ответить сервер)"
