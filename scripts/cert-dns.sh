#!/usr/bin/env bash
#
# Выпуск сертификата для api.23podari.ru через проверку по DNS (DNS-01).
# Подходит, когда HTTP-проверка не доходит до сервера (международный трафик глохнет).
# Использует Timeweb Cloud DNS API через acme.sh.
#
set -e
DOMAIN="api.23podari.ru"
EMAIL="visokihelenasochi@gmail.com"
CERTDIR="/etc/caddy/certs"
ACME="$HOME/.acme.sh/acme.sh"

# ---- 1. Токен Timeweb ----
if [ -z "${TW_Token:-}" ]; then
  echo "Вставь свой Timeweb API-токен и нажми Enter."
  echo "(он не будет виден на экране — это нормально)"
  read -r -s TW_Token
  echo
fi
[ -z "$TW_Token" ] && { echo "Токен пустой — прерываю."; exit 1; }
export TW_Token

# ---- 2. Устанавливаем acme.sh ----
if [ ! -f "$ACME" ]; then
  echo "==> Устанавливаю acme.sh..."
  curl -fsSL https://get.acme.sh | sh -s email="$EMAIL" >/dev/null 2>&1 || true
fi
[ -f "$ACME" ] || { echo "Не удалось установить acme.sh"; exit 1; }

# ---- 3. Выпускаем сертификат через DNS ----
echo "==> Выпускаю сертификат для $DOMAIN через DNS (1-2 минуты)..."
"$ACME" --set-default-ca --server letsencrypt >/dev/null 2>&1 || true
"$ACME" --issue --dns dns_timeweb -d "$DOMAIN" --dnssleep 60

# ---- 4. Устанавливаем сертификат для Caddy ----
mkdir -p "$CERTDIR"
"$ACME" --install-cert -d "$DOMAIN" \
  --key-file "$CERTDIR/$DOMAIN.key" \
  --fullchain-file "$CERTDIR/$DOMAIN.crt" \
  --reloadcmd "systemctl reload caddy || systemctl restart caddy"
chown -R caddy:caddy "$CERTDIR" 2>/dev/null || true

# ---- 5. Caddy на готовый сертификат (без авто-ACME) ----
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    encode gzip
    reverse_proxy 127.0.0.1:8000
    tls $CERTDIR/$DOMAIN.crt $CERTDIR/$DOMAIN.key
}
EOF
systemctl restart caddy
sleep 3

echo ""
if systemctl is-active --quiet caddy; then
  echo "✓ Caddy запущен с готовым сертификатом."
else
  echo "✗ Caddy не стартовал:"; journalctl -u caddy --no-pager | tail -15; exit 1
fi
echo ""
echo "===== ФАЙЛЫ СЕРТИФИКАТА ====="
ls -l "$CERTDIR"
echo ""
echo "🎉 Готово! База должна работать по https://$DOMAIN"
echo "Автопродление сертификата настроено (через DNS, само)."
