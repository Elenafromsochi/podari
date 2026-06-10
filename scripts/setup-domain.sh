#!/usr/bin/env bash
#
# Переводит базу Supabase на собственный домен api.23podari.ru
# и выпускает настоящий сертификат через Let's Encrypt
# (на своём домене лимиты только твои — сработает сразу).
#
# Запускать ТОЛЬКО после того, как поддомен api.23podari.ru
# создан и указывает на этот сервер (5.42.111.169).
#
DOMAIN="api.23podari.ru"
EMAIL="visokihelenasochi@gmail.com"
SUPADIR="/opt/supabase"

echo "==> 1/3  Настраиваю Caddy на $DOMAIN"
cat > /etc/caddy/Caddyfile <<EOF
{
    email $EMAIL
}

$DOMAIN {
    encode gzip
    reverse_proxy 127.0.0.1:8000
}
EOF
systemctl restart caddy

echo "==> 2/3  Обновляю адрес базы в настройках Supabase"
cd "$SUPADIR" || { echo "Нет папки $SUPADIR"; exit 1; }
export V_DOMAIN="$DOMAIN"
python3 <<'PY'
import os, re
url = "https://" + os.environ["V_DOMAIN"]
d = open(".env").read()
for k in ["API_EXTERNAL_URL", "SUPABASE_PUBLIC_URL"]:
    if re.search(r'(?m)^'+k+'=', d):
        d = re.sub(r'(?m)^'+k+r'=.*$', k+'='+url, d)
    else:
        d += ('' if d.endswith('\n') else '\n') + k+'='+url+'\n'
open(".env", "w").write(d)
print("   Адрес базы обновлён на", url)
PY
docker compose up -d

echo "==> 3/3  Жду выпуск сертификата (~60 сек)..."
sleep 60
echo ""
echo "===== ЖУРНАЛ CADDY (ищем 'certificate obtained successfully') ====="
journalctl -u caddy --no-pager | tail -20

echo ""
echo "===== ДОСТУП ДЛЯ ПРИЛОЖЕНИЯ ====="
echo "Адрес базы (URL): https://$DOMAIN"
echo "anon key — смотри в файле: cat /root/supabase-secrets.txt"
echo "(anon key не изменился — он тот же, что был при установке)"
