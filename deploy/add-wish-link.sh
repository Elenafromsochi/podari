#!/usr/bin/env bash
#
# Добавляет в ОБЛАЧНУЮ базу (Supabase, где живёт продакшн-сайт) колонку
# wishes.link — чтобы у желаний сохранялась ссылка на пример подарка.
# Одна ALTER-команда, с повторами на случай обрывов связи.
#
# Запуск на сервере Timeweb:
#   cd /opt/podari && git pull && bash deploy/add-wish-link.sh
#
set -uo pipefail

HOST="aws-0-eu-west-1.pooler.supabase.com"
PORT="5432"
USER="postgres.pvankvojplctgthlvtto"
DB="postgres"
PWFILE="/root/dbpass"

[ -s "$PWFILE" ] || {
  echo "Нет файла с паролем базы ($PWFILE)."
  echo "Создай его паролем облачной базы Supabase, например:"
  echo "  printf 'ПАРОЛЬ_БАЗЫ' > /root/dbpass"
  exit 1
}
PW="$(cat "$PWFILE")"
IMG="postgres:17-alpine"; docker image inspect "$IMG" >/dev/null 2>&1 || IMG="postgres:17"

run_sql() {
  timeout 60 docker run --rm --network host \
    -e PGPASSWORD="$PW" -e PGSSLMODE=require -e PGCONNECT_TIMEOUT=20 "$IMG" \
    psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -v ON_ERROR_STOP=1 "$@"
}

echo "===== Добавляю колонку wishes.link в облачную базу ====="
n=1; ok=0
while [ "$n" -le 6 ]; do
  echo "  ...попытка $n"
  if run_sql -c "ALTER TABLE public.wishes ADD COLUMN IF NOT EXISTS link text;" 2>/tmp/wl_err; then
    ok=1; break
  fi
  echo "  обрыв/таймаут, повтор через 4с..."; sleep 4; n=$((n + 1))
done
[ "$ok" = 1 ] || { echo "!! не удалось за 6 попыток:"; tail -3 /tmp/wl_err; exit 1; }

echo "===== Проверка ====="
FOUND="$(run_sql -tAc \
  "select column_name from information_schema.columns
   where table_schema='public' and table_name='wishes' and column_name='link';" 2>/dev/null | tr -d '[:space:]')"
if [ "$FOUND" = "link" ]; then
  echo "✅ Колонка link на месте — ссылки в желаниях теперь будут сохраняться."
else
  echo "⚠️ Колонку не видно. Пришли вывод выше — гляну."
fi
