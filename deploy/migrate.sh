#!/usr/bin/env bash
#
# Перенос данных из облачного Supabase в self-hosted на сервере.
# Облако только ЧИТАЕМ. Локальная схема уже есть — грузим ТОЛЬКО данные
# (так легче и устойчивее к обрывам от DDoS). Пароль — из /root/dbpass.
# Запуск:  cd /opt/podari && git pull && bash deploy/migrate.sh
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
DUMP=/root/dump_data.sql

# Тайм-ауты не дают команде зависнуть: не подключился за 20с / запрос >90с —
# падаем и повторяем. timeout 150 — общий предохранитель на попытку.
cloud_dump() {
  timeout 150 docker run --rm --network host \
    -e PGPASSWORD="$PW" -e PGSSLMODE=require -e PGCONNECT_TIMEOUT=20 \
    -e PGOPTIONS="-c statement_timeout=90000 -c lock_timeout=15000" "$IMG" \
    pg_dump -h "$HOST" -p "$PORT" -U "$USER" -d "$DB" "$@"
}

echo "===== Выгружаю ДАННЫЕ из облака (с повторами при обрывах) ====="
n=1
ok=0
while [ "$n" -le 10 ]; do
  echo "  ...попытка $n"
  if cloud_dump --data-only --disable-triggers --no-owner \
       --schema=public \
       --table=auth.users --table=auth.identities \
       --table=storage.buckets --table=storage.objects \
       > "$DUMP" 2>/tmp/derr && [ -s "$DUMP" ]; then
    echo "  OK: дамп $(wc -c < "$DUMP") байт"
    ok=1; break
  fi
  echo "  обрыв/таймаут, повтор через 4с..."; sleep 4; n=$((n + 1))
done
[ "$ok" = 1 ] || { echo "!! не удалось выгрузить за 10 попыток:"; tail -3 /tmp/derr; exit 1; }

cd "$SUPADIR" || { echo "Нет $SUPADIR"; exit 1; }

echo "===== Заливаю данные в локальную базу ====="
docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=0 \
  < "$DUMP" >/root/load.log 2>&1
echo "  ошибок в логе: $(grep -ci 'error' /root/load.log)  (лог: /root/load.log)"
grep -i 'error' /root/load.log | head -8

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
