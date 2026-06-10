#!/usr/bin/env bash
#
# Переключает Caddy на выпуск сертификата через ZeroSSL
# (запасной сервис, когда Let's Encrypt временно ограничил выдачу).
#
set -e
DOMAIN="api.elenafromsochi-podari-012b.twc1.net"
EMAIL="visokihelenasochi@gmail.com"

cat > /etc/caddy/Caddyfile <<EOF
{
    email $EMAIL
}

$DOMAIN {
    encode gzip
    reverse_proxy 127.0.0.1:8000
    tls {
        issuer zerossl
        issuer acme
    }
}
EOF

systemctl restart caddy
echo "Caddy перенастроен на ZeroSSL. Жду выпуск сертификата (~90 сек)..."
sleep 90
echo "===== СВЕЖИЙ ЖУРНАЛ CADDY ====="
journalctl -u caddy --no-pager | tail -30
