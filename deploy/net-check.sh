#!/usr/bin/env bash
#
# Чистая проверка: дотягивается ли сервер до облачного Supabase.
# Адреса зашиты в скрипт, чтобы вставка в консоль ничего не покорёжила.
# Запуск:  cd /opt/podari && git pull && bash deploy/net-check.sh
#
test_tcp() {
  local host="$1" port="$2"
  if timeout 8 bash -c "exec 3<>/dev/tcp/$host/$port" 2>/dev/null; then
    echo "OK    $host:$port  — связь ЕСТЬ"
  else
    echo "FAIL  $host:$port  — нет связи"
  fi
}

echo "===== Сервер -> облако Supabase ====="
test_tcp aws-0-eu-west-1.pooler.supabase.com 5432   # session pooler (для выгрузки)
test_tcp aws-0-eu-west-1.pooler.supabase.com 6543   # transaction pooler
test_tcp pvankvojplctgthlvtto.supabase.co 443       # REST API облака
test_tcp db.pvankvojplctgthlvtto.supabase.co 5432   # прямое подключение к БД

echo
echo "===== Контроль (тут должно быть OK) ====="
test_tcp github.com 443
test_tcp api.proxyapi.ru 443
