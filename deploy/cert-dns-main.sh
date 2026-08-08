#!/usr/bin/env bash
#
# Выпуск сертификата для 23podari.ru + www.23podari.ru + api.23podari.ru
# через проверку по DNS (DNS-01, Timeweb Cloud DNS API + acme.sh) — в обход
# HTTP-01/ZeroSSL EAB, у которых международная проверка до этого сервера
# ненадёжна (см. scripts/cert-dns.sh — тот же приём, но только для api).
#
# Запуск на сервере:
#   cd /opt/podari && git pull && bash deploy/cert-dns-main.sh
#
set -e
DOMAINS=(23podari.ru www.23podari.ru api.23podari.ru)
EMAIL="visokihelenasochi@gmail.com"
CERTDIR="/etc/caddy/certs"
ACME="$HOME/.acme.sh/acme.sh"

# ---- 1. Токен Timeweb Cloud ----
if [ -z "${TW_Token:-}" ]; then
  echo "Вставь свой Timeweb Cloud API-токен и нажми Enter."
  echo "(Личный кабинет Timeweb Cloud -> Настройки -> API -> создать ключ)"
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

# ---- 3. Выпускаем ОДИН сертификат сразу на все три домена ----
echo "==> Выпускаю сертификат для ${DOMAINS[*]} через DNS (1-2 минуты)..."
"$ACME" --set-default-ca --server letsencrypt >/dev/null 2>&1 || true
DARGS=()
for d in "${DOMAINS[@]}"; do DARGS+=(-d "$d"); done
"$ACME" --issue --dns dns_timeweb "${DARGS[@]}" --dnssleep 180

# ---- 4. Устанавливаем сертификат ----
mkdir -p "$CERTDIR"
"$ACME" --install-cert -d "${DOMAINS[0]}" \
  --key-file "$CERTDIR/main.key" \
  --fullchain-file "$CERTDIR/main.crt" \
  --reloadcmd "systemctl reload caddy || systemctl restart caddy"
chown -R caddy:caddy "$CERTDIR" 2>/dev/null || true

# ---- 5. Caddy на готовый сертификат (без авто-ACME по HTTP) ----
cat > /etc/caddy/Caddyfile <<EOF
23podari.ru, www.23podari.ru {
    encode gzip
    reverse_proxy 127.0.0.1:3000
    tls $CERTDIR/main.crt $CERTDIR/main.key
}

api.23podari.ru {
    encode gzip
    reverse_proxy 127.0.0.1:8000
    tls $CERTDIR/main.crt $CERTDIR/main.key
}
EOF
systemctl restart caddy
sleep 3

echo ""
if systemctl is-active --quiet caddy; then
  echo "OK: Caddy запущен с готовым сертификатом."
else
  echo "FAIL: Caddy не стартовал:"; journalctl -u caddy --no-pager | tail -15; exit 1
fi
echo ""
echo "===== ФАЙЛЫ СЕРТИФИКАТА ====="
ls -l "$CERTDIR"
echo ""
echo "Готово! Проверь https://23podari.ru"
echo "Автопродление настроено само (через DNS, cron acme.sh)."
