#!/usr/bin/env bash
#
# Перенос данных из облачного Supabase в self-hosted на сервере.
# Облако только ЧИТАЕМ (pg_dump). Локальная база пустая — пишем в неё.
# Пароль берётся из /root/dbpass. Запуск:
#   cd /opt/podari && git pull && bash deploy/migrate.sh
#
# ВНИМАНИЕ: переносятся данные БД (профили, подарки, чаты, аккаунты).
# Сами файлы фотографий (хранилище) переносятся отдельным шагом.
#
set -uo pipefail

HOST="aws-0-eu-west-1.pooler.supabase.com"
PORT="5432"
USER="postgres.pvankvojplctgthlvtto"
DB="postgres"
PWFILE="/root/dbpass"
SUPADIR="/opt/supabase"

[ -s "$PWFILE" ] || { echo "Нет файла $PWFILE — создай: printf 'ПАРОЛЬ' > /root/dbpass"; exit 1; }
PW="$(cat "$PWFILE")"

IMG="postgres:17-alpine"; docker image inspect "$IMG" >/dev/null 2>&1 || IMG="postgres:17"

DUMP_PUBLIC=/root/dump_public.sql
DUMP_DATA=/root/dump_authstorage.sql

cloud_dump() {
  docker run --rm --network host -e PGPASSWORD="$PW" -e PGSSLMODE=require "$IMG" \
    pg_dump -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" "$@"
}

# Выгрузка с повторами — DDoS у хостинга иногда рвёт соединение.
retry_dump() {
  local out="$1"; shift
  local n=1
  while [ "$n" -le 8 ]; do
    echo "  ...выгрузка ($(basename "$out"), попытка $n)"
    if cloud_dump "$@" > "$out" 2>/tmp/derr && [ -s "$out" ]; then
      echo "  OK: $(basename "$out") — $(wc -c < "$out") байт"
      return 0
    fi
    echo "  обрыв, повтор через 3с..."; sleep 3; n=$((n + 1))
  done
  echo "  !! не удалось выгрузить за 8 попыток:"; tail -3 /tmp/derr
  return 1
}

echo "===== 1/4  Выгружаю public (схема + данные) ====="
retry_dump "$DUMP_PUBLIC" --no-owner --no-privileges --clean --if-exists --schema=public || exit 1

echo "===== 2/4  Выгружаю данные auth + storage ====="
retry_dump "$DUMP_DATA" --no-owner --data-only --disable-triggers \
  --table=auth.users --table=auth.identities \
  --table=storage.buckets --table=storage.objects || exit 1

cd "$SUPADIR" || { echo "Нет $SUPADIR"; exit 1; }

echo "===== 3/4  Заливаю auth + storage в локальную базу ====="
docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=0 \
  < "$DUMP_DATA" >/root/load_auth.log 2>&1
echo "  лог: /root/load_auth.log (последние строки)"; tail -6 /root/load_auth.log

echo "===== 4/4  Заливаю public в локальную базу ====="
docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=0 \
  < "$DUMP_PUBLIC" >/root/load_public.log 2>&1
echo "  лог: /root/load_public.log (последние строки)"; tail -6 /root/load_public.log

echo
echo "===== ИТОГ: что теперь в локальной базе ====="
docker compose exec -T db psql -U postgres -d postgres -tAc \
  "select 'profiles=' || count(*) from public.profiles;
   select 'gifts=' || count(*) from public.gifts;
   select 'transactions=' || count(*) from public.transactions;
   select 'auth_users=' || count(*) from auth.users;
   select 'storage_objects=' || count(*) from storage.objects;"
echo
echo "Сравни с облаком: profiles=14, gifts=30, transactions=35, auth_users=14, storage_objects=61"
echo "Если совпало — данные на сервере! (фото-файлы перенесём отдельным шагом)"
