#!/usr/bin/env bash
#
# Перенос схемы public ЦЕЛИКОМ (структура + данные) из облака на локальный
# self-hosted Supabase. Делаем чистую замену: сносим всю схему public одной
# командой (DROP SCHEMA ... CASCADE) и заливаем заново из облачного дампа.
# Так не остаётся старых колонок, нет ошибок «уже существует» и нет дублей
# (которые в прошлый раз раздули transactions до 140).
#
# auth и storage уже загружены отдельно — их НЕ трогаем.
# Запуск:
#   cd /opt/podari && git pull && bash deploy/migrate-public.sh
#
set -uo pipefail

HOST="aws-0-eu-west-1.pooler.supabase.com"
PORT="5432"
USER="postgres.pvankvojplctgthlvtto"
DB="postgres"
PWFILE="/root/dbpass"
SUPADIR="/opt/supabase"

[ -s "$PWFILE" ] || { echo "Нет $PWFILE"; exit 1; }
PW="$(cat "$PWFILE")"
SUPER_PW="$(grep -m1 '^POSTGRES_PASSWORD=' "$SUPADIR/.env" | cut -d= -f2-)"
IMG="postgres:17-alpine"; docker image inspect "$IMG" >/dev/null 2>&1 || IMG="postgres:17"
RAW="/root/dump_public_full.sql"
DUMP="/root/dump_public_clean.sql"

cloud_dump() {
  timeout 180 docker run --rm --network host \
    -e PGPASSWORD="$PW" -e PGSSLMODE=require -e PGCONNECT_TIMEOUT=20 \
    -e PGOPTIONS="-c statement_timeout=120000 -c lock_timeout=15000" "$IMG" \
    pg_dump -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" "$@"
}

echo "===== 1/3  Выгружаю public (структура + данные) из облака ====="
n=1; ok=0
while [ "$n" -le 10 ]; do
  echo "  ...попытка $n"
  # БЕЗ --clean: чистим схему сами, ниже. Привилегии (GRANT/RLS) оставляем,
  # чтобы приложение видело таблицы; владельца не трогаем (--no-owner).
  if cloud_dump --no-owner --schema=public > "$RAW" 2>/tmp/derr && [ -s "$RAW" ]; then
    echo "  OK: дамп $(wc -c < "$RAW") байт"; ok=1; break
  fi
  echo "  обрыв/таймаут, повтор через 4с..."; sleep 4; n=$((n + 1))
done
[ "$ok" = 1 ] || { echo "!! не удалось выгрузить за 10 попыток:"; tail -3 /tmp/derr; exit 1; }

# Параметры сессии, которых нет в PostgreSQL 15 (база в облаке — PG17).
sed -e '/^SET transaction_timeout/d' \
    -e '/^SET idle_session_timeout/d' \
    "$RAW" > "$DUMP"

cd "$SUPADIR" || { echo "Нет $SUPADIR"; exit 1; }
psql_su() {
  docker compose exec -T -e PGPASSWORD="$SUPER_PW" db \
    psql -U supabase_admin -d postgres -v ON_ERROR_STOP=0 "$@"
}

echo "===== 2/3  Сношу схему public целиком и заливаю заново ====="
# Чистый снос всей схемы одной командой — убирает таблицы, функции, триггеры
# (в т.ч. handle_new_user, который плодил мусорные профили) и все зависимости.
# Затем восстанавливаем пустую схему с правами для ролей Supabase.
psql_su >/root/dropschema.log 2>&1 <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL    ON SCHEMA public TO postgres, supabase_admin, service_role;
SQL
echo "  снос/создание схемы: ошибок $(grep -ci 'ERROR' /root/dropschema.log)"

# session_replication_role=replica отключает проверки FK на время заливки.
{ echo "SET session_replication_role = replica;"; cat "$DUMP"; } \
  | psql_su >/root/loadpub.log 2>&1
echo "  ошибок при заливке: $(grep -ci 'ERROR' /root/loadpub.log)"
grep -i 'ERROR' /root/loadpub.log | head -10

echo
echo "===== 3/3  ИТОГ ====="
psql_su -tAc \
  "select 'profiles=' || count(*) from public.profiles;
   select 'gifts=' || count(*) from public.gifts;
   select 'transactions=' || count(*) from public.transactions;
   select 'messages=' || count(*) from public.messages;
   select 'reviews=' || count(*) from public.reviews;
   select 'auth_users=' || count(*) from auth.users;
   select 'storage_objects=' || count(*) from storage.objects;"
echo
echo "Цель: profiles=14, gifts=30, transactions=35, messages=30, reviews=18, auth_users=14, storage_objects=61"
