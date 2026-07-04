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
# Пробуем оба пула: 6543 (транзакционный, часто «пролезает») и 5432 (сессионный).
PORTS="6543 5432"
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
  local port="$1"; shift
  timeout 45 docker run --rm --network host \
    -e PGPASSWORD="$PW" -e PGSSLMODE=require -e PGCONNECT_TIMEOUT=15 "$IMG" \
    psql -h "$HOST" -p "$port" -U "$USER" -d "$DB" -v ON_ERROR_STOP=1 "$@"
}

echo "===== Добавляю колонку wishes.link в облачную базу ====="
n=1; ok=0; GOODPORT=""
while [ "$n" -le 15 ]; do
  for p in $PORTS; do
    echo "  ...попытка $n (порт $p)"
    if run_sql "$p" -c "ALTER TABLE public.wishes ADD COLUMN IF NOT EXISTS link text;" 2>/tmp/wl_err; then
      ok=1; GOODPORT="$p"; break
    fi
  done
  [ "$ok" = 1 ] && break
  echo "  обрыв/таймаут, повтор через 4с..."; sleep 4; n=$((n + 1))
done
[ "$ok" = 1 ] || {
  echo "!! не удалось за 15 попыток — связь с облаком не проходит:"; tail -3 /tmp/wl_err
  echo "Сделай это из браузера в Supabase SQL Editor — напиши мне, помогу."
  exit 1
}

echo "===== Проверка ====="
FOUND="$(run_sql "$GOODPORT" -tAc \
  "select column_name from information_schema.columns
   where table_schema='public' and table_name='wishes' and column_name='link';" 2>/dev/null | tr -d '[:space:]')"
if [ "$FOUND" = "link" ]; then
  echo "✅ Колонка link на месте — ссылки в желаниях теперь будут сохраняться."
else
  echo "⚠️ Колонку не видно. Пришли вывод выше — гляну."
fi
