#!/usr/bin/env bash
#
# Перенос ФАЙЛОВ хранилища (фото подарков и желаний) из облачного Supabase на
# self-hosted сервер. Метаданные (storage.objects) уже в базе, но сами картинки
# лежат в облаке — здесь мы:
#   1) скачиваем каждый файл из облака (бакеты публичные — ключ не нужен),
#   2) заливаем его в локальное хранилище через Storage API,
#   3) переписываем ссылки в базе с облачного адреса на адрес сервера,
#      иначе фото так и грузились бы из облака (через VPN).
#
# Запуск:  cd /opt/podari && git pull && bash deploy/migrate-storage.sh
#
set -uo pipefail

SUPADIR="/opt/supabase"
CLOUD="https://pvankvojplctgthlvtto.supabase.co"
# Публичный адрес ВАШЕГО Supabase (через Caddy → Kong). На него будут указывать
# ссылки на фото после переноса.
NEWHOST="https://api.23podari.ru"
# Локально Kong (Storage API) слушает здесь.
API="http://127.0.0.1:8000"

cd "$SUPADIR" || { echo "Нет $SUPADIR"; exit 1; }
SUPER_PW="$(grep -m1 '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)"
SERVICE_KEY="$(grep -m1 '^SERVICE_ROLE_KEY=' .env | cut -d= -f2-)"
[ -n "$SERVICE_KEY" ] || { echo "Нет SERVICE_ROLE_KEY в $SUPADIR/.env"; exit 1; }

psql_su() {
  docker compose exec -T -e PGPASSWORD="$SUPER_PW" db \
    psql -U supabase_admin -d postgres -v ON_ERROR_STOP=0 "$@"
}

echo "===== 1/4  Список бакетов и файлов из базы ====="
psql_su -tAF $'\t' -c "select id, public from storage.buckets;" > /root/buckets.tsv
psql_su -tAF $'\t' -c "select bucket_id, name from storage.objects order by bucket_id, name;" > /root/objlist.tsv
echo "  бакетов: $(wc -l < /root/buckets.tsv), файлов: $(wc -l < /root/objlist.tsv)"

echo "===== 2/4  Создаю бакеты и чищу метаданные (файлы создадутся заново) ====="
while IFS=$'\t' read -r bid pub; do
  [ -n "$bid" ] || continue
  pubjson=false; [ "$pub" = "t" ] && pubjson=true
  curl -sS -o /dev/null -X POST "$API/storage/v1/bucket" \
    -H "Authorization: Bearer $SERVICE_KEY" -H "apikey: $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"id\":\"$bid\",\"name\":\"$bid\",\"public\":$pubjson}" || true
done < /root/buckets.tsv
# Под перенесёнными ранее строками реальных файлов на диске нет — чистим, чтобы
# Storage API создал их заново при заливке (с корректной раскладкой на диске).
psql_su -c "truncate storage.objects;" >/dev/null 2>&1

echo "===== 3/4  Качаю из облака и заливаю на сервер ====="
ok=0; fail=0
while IFS=$'\t' read -r b name; do
  [ -n "$name" ] || continue
  src="$CLOUD/storage/v1/object/public/$b/$name"
  ct=""; n=1
  while [ "$n" -le 5 ]; do
    code=$(curl -sS -m 60 -w '%{http_code}' -D /tmp/hh -o /tmp/obj.bin "$src" 2>/dev/null || echo 000)
    if [ "$code" = "200" ] && [ -s /tmp/obj.bin ]; then
      ct=$(awk 'tolower($1)=="content-type:"{print $2}' /tmp/hh | tr -d '\r')
      break
    fi
    sleep 3; n=$((n + 1))
  done
  if [ -z "$ct" ]; then echo "  ✗ не скачал: $b/$name"; fail=$((fail + 1)); continue; fi
  up=$(curl -sS -m 120 -w '%{http_code}' -o /dev/null -X POST "$API/storage/v1/object/$b/$name" \
        -H "Authorization: Bearer $SERVICE_KEY" -H "apikey: $SERVICE_KEY" \
        -H "x-upsert: true" -H "Content-Type: ${ct:-application/octet-stream}" \
        --data-binary @/tmp/obj.bin 2>/dev/null || echo 000)
  if [ "$up" = "200" ] || [ "$up" = "201" ]; then
    ok=$((ok + 1))
  else
    echo "  ✗ не залил (код $up): $b/$name"; fail=$((fail + 1))
  fi
done < /root/objlist.tsv
echo "  залито: $ok, ошибок: $fail"

echo "===== 4/4  Переписываю ссылки в базе: $CLOUD -> $NEWHOST ====="
psql_su >/dev/null 2>&1 <<SQL
update public.gifts  set image_url = replace(image_url, '$CLOUD', '$NEWHOST') where image_url like '$CLOUD%';
update public.wishes set image_url = replace(image_url, '$CLOUD', '$NEWHOST') where image_url like '$CLOUD%';
update public.gifts  set image_urls = (select array_agg(replace(u, '$CLOUD', '$NEWHOST')) from unnest(image_urls) u)
  where array_to_string(image_urls, ',') like '%$CLOUD%';
update public.wishes set image_urls = (select array_agg(replace(u, '$CLOUD', '$NEWHOST')) from unnest(image_urls) u)
  where array_to_string(image_urls, ',') like '%$CLOUD%';
SQL

echo
echo "===== ИТОГ ====="
psql_su -tAc \
  "select 'storage_objects=' || count(*) from storage.objects;
   select 'gifts_с_облачными_ссылками_осталось=' || count(*) from public.gifts where image_url like '$CLOUD%' or array_to_string(image_urls, ',') like '%$CLOUD%';"
echo
echo "Готово. Когда api.23podari.ru заработает (после переноса сайта и DNS),"
echo "фото будут грузиться с сервера. Цель: storage_objects=61, облачных ссылок 0."
