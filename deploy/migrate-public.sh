#!/usr/bin/env bash
#
# Догрузка данных схемы public (профили, подарки, сделки, сообщения, отзывы),
# которые не попали в первый дамп. auth и storage уже загружены — их не трогаем.
# Качаем из облака ТОЛЬКО public, грузим под supabase_admin с отключёнными
# триггерами/FK. Запуск:
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
DUMP="/root/dump_public.sql"

cloud_dump() {
  timeout 150 docker run --rm --network host \
    -e PGPASSWORD="$PW" -e PGSSLMODE=require -e PGCONNECT_TIMEOUT=20 \
    -e PGOPTIONS="-c statement_timeout=90000 -c lock_timeout=15000" "$IMG" \
    pg_dump -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" "$@"
}

echo "===== 1/3  Выгружаю public из облака (с повторами) ====="
n=1; ok=0
while [ "$n" -le 10 ]; do
  echo "  ...попытка $n"
  if cloud_dump --data-only --no-owner --schema=public > "$DUMP" 2>/tmp/derr && [ -s "$DUMP" ]; then
    echo "  OK: дамп public $(wc -c < "$DUMP") байт"; ok=1; break
  fi
  echo "  обрыв/таймаут, повтор через 4с..."; sleep 4; n=$((n + 1))
done
[ "$ok" = 1 ] || { echo "!! не удалось выгрузить за 10 попыток:"; tail -3 /tmp/derr; exit 1; }

cd "$SUPADIR" || { echo "Нет $SUPADIR"; exit 1; }
psql_su() {
  docker compose exec -T -e PGPASSWORD="$SUPER_PW" db \
    psql -U supabase_admin -d postgres -v ON_ERROR_STOP=0 "$@"
}

echo "===== 2/3  Чищу public и заливаю заново ====="
psql_su >/root/cleanpub.log 2>&1 <<'SQL'
SET session_replication_role = replica;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT format('%I.%I', schemaname, tablename) AS t
           FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE 'TRUNCATE TABLE ' || r.t || ' CASCADE';
  END LOOP;
END $$;
SQL
{ echo "SET session_replication_role = replica;"; cat "$DUMP"; } | psql_su >/root/loadpub.log 2>&1
echo "  ошибок при заливке: $(grep -ci error /root/loadpub.log)"; grep -i error /root/loadpub.log | head -10

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
