#!/usr/bin/env bash
#
# Проверка перед миграцией: связь с облачным Supabase, объём данных, версии.
# Только чтение, ничего не меняет. Запуск:
#   cd /opt/podari && git pull && bash deploy/cloud-check.sh
#
set -uo pipefail

# Данные облачного проекта (Ирландия). Пароль НЕ хранится — спросим при запуске.
HOST="aws-0-eu-west-1.pooler.supabase.com"
PORT="5432"
USER="postgres.pvankvojplctgthlvtto"
DB="postgres"
SUPADIR="/opt/supabase"

echo "Вставь пароль БД из Supabase (его не будет видно), затем Enter:"
read -rs PW
echo

cd "$SUPADIR" || { echo "Нет папки $SUPADIR"; exit 1; }

echo
echo "===== ЛОКАЛЬНАЯ база (на сервере) ====="
docker compose exec -T db psql -U postgres -d postgres -tAc \
  "select 'local_pg=' || current_setting('server_version');" \
  || echo "!! локальная база не ответила"

echo
echo "===== ОБЛАКО (связь + данные) ====="
docker compose exec -T -e PGPASSWORD="$PW" -e PGSSLMODE=require db \
  psql -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" -tAc \
  "select 'cloud_pg=' || current_setting('server_version');
   select 'profiles=' || count(*) from public.profiles;
   select 'gifts=' || count(*) from public.gifts;
   select 'auth_users=' || count(*) from auth.users;" \
  && echo "OK: связь с облаком есть" \
  || echo "!! не удалось подключиться к облаку (пароль/сеть)"
