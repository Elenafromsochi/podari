#!/usr/bin/env bash
#
# Переключает Caddy на выпуск сертификата через ZeroSSL.
# Let's Encrypt для общего домена twc1.net недоступен (исчерпан лимит),
# поэтому используем ZeroSSL (он подключается, когда задана почта).
#
DOMAIN="api.elenafromsochi-podari-012b.twc1.net"
EMAIL="visokihelenasochi@gmail.com"

cat > /etc/caddy/Caddyfile <<EOF
{
    email $EMAIL
}

$DOMAIN {
    encode gzip
    reverse_proxy 127.0.0.1:8000
}
EOF

echo "Перезапускаю Caddy..."
systemctl restart caddy || true
sleep 3

if systemctl is-active --quiet caddy; then
  echo "✓ Caddy запущен."
else
  echo "✗ Caddy не запустился. Журнал:"
  journalctl -u caddy --no-pager | tail -20
  exit 1
fi

echo "Жду выпуск сертификата через ZeroSSL (~2 минуты)..."
sleep 120
echo "===== СВЕЖИЙ ЖУРНАЛ CADDY ====="
journalctl -u caddy --no-pager | tail -30
