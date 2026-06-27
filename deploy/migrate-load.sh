#!/usr/bin/env bash
#
# Перезаливка уже скачанного дампа (/root/dump_data.sql) в локальную базу
# под СУПЕРПОЛЬЗОВАТЕЛЕМ supabase_admin — чтобы триггеры/FK реально
# отключились и данные легли правильно (профили/подарки/сделки). Из облака
# повторно НЕ качаем.
# Запуск:  cd /opt/podari && git pull && bash deploy/migrate-load.sh
#
set -uo pipefail

SUPADIR="/opt/supabase"
DUMP="/root/dump_data.sql"

[ -s "$DUMP" ] || { echo "Нет дампа $DUMP — сначала запусти migrate.sh"; exit 1; }
cd "$SUPADIR" || { echo "Нет $SUPADIR"; exit 1; }

# Пароль суперпользователя берём из настроек Supabase (на случай, если
# локальный сокет всё же спросит пароль).
SUPER_PW="$(grep -m1 '^POSTGRES_PASSWORD=' "$SUPADIR/.env" | cut -d= -f2-)"

psql_su() {
  docker compose exec -T -e PGPASSWORD="$SUPER_PW" db \
    psql -U supabase_admin -d postgres -v ON_ERROR_STOP=0 "$@"
}

echo "===== 1/3  Чищу частичные/триггерные данные ====="
psql_su >/root/clean.log 2>&1 <<'SQL'
SET session_replication_role = replica;
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT format('%I.%I', schemaname, tablename) AS t
           FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE 'TRUNCATE TABLE ' || r.t || ' CASCADE';
  END LOOP;
END $$;
TRUNCATE auth.identities, auth.users, storage.objects, storage.buckets CASCADE;
SQL
echo "  ошибок при очистке: $(grep -ci error /root/clean.log)"; grep -i error /root/clean.log | head -3

echo "===== 2/3  Заливаю дамп под supabase_admin ====="
psql_su < "$DUMP" >/root/load2.log 2>&1
echo "  ошибок при заливке: $(grep -ci error /root/load2.log)"; grep -i error /root/load2.log | head -10

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
echo "Цель (как в облаке): profiles=14, gifts=30, transactions=35, auth_users=14, storage_objects=61"
