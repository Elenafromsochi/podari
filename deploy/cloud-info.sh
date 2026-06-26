#!/usr/bin/env bash
#
# Сбор данных для плана миграции: версия облачной БД и количество записей.
# Только чтение. Использует клиент postgres:17 в контейнере с сетью хоста
# (мы убедились, что хост дотягивается до облака).
# Запуск:  cd /opt/podari && git pull && bash deploy/cloud-info.sh
#
set -uo pipefail

HOST="aws-0-eu-west-1.pooler.supabase.com"
PORT="5432"
USER="postgres.pvankvojplctgthlvtto"
DB="postgres"
PWFILE="/root/dbpass"

# Пароль НЕ спрашиваем интерактивно (в консоли айпада ввод ломается).
# Берём его из файла /root/dbpass, который ты создашь руками один раз:
#   printf 'ТВОЙ_ПАРОЛЬ' > /root/dbpass
if [ ! -s "$PWFILE" ]; then
  echo "!! Нет файла с паролем ($PWFILE)."
  echo "   Создай его, напечатав РУКАМИ (подставь свой пароль БД):"
  echo "     printf 'Podari2026migrate' > /root/dbpass"
  echo "   потом запусти этот скрипт снова."
  exit 1
fi
PW="$(cat "$PWFILE")"

echo "Готовлю клиент postgres:17 (скачается один раз, ~30 сек)..."
docker pull postgres:17-alpine >/dev/null 2>&1 || docker pull postgres:17 >/dev/null 2>&1 || true
IMG="postgres:17-alpine"; docker image inspect "$IMG" >/dev/null 2>&1 || IMG="postgres:17"

echo
echo "===== ОБЛАКО: версия и объём данных ====="
docker run --rm --network host -e PGPASSWORD="$PW" -e PGSSLMODE=require "$IMG" \
  psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -tAc \
  "select 'cloud_pg=' || current_setting('server_version');
   select 'profiles=' || count(*) from public.profiles;
   select 'gifts=' || count(*) from public.gifts;
   select 'transactions=' || count(*) from public.transactions;
   select 'messages=' || count(*) from public.messages;
   select 'reviews=' || count(*) from public.reviews;
   select 'auth_users=' || count(*) from auth.users;
   select 'storage_objects=' || count(*) from storage.objects;" \
  && echo "OK: данные прочитаны" \
  || echo "!! не удалось прочитать (пароль/сеть)"

