#!/usr/bin/env bash
#
# Установщик собственной базы Supabase для проекта «Подари».
# Разворачивает Supabase на сервере в России, настраивает HTTPS,
# загружает схему базы и создаёт хранилища для картинок.
#
# Запуск (из-под root):
#   curl -fsSL <RAW_URL>/scripts/install-supabase.sh | bash
#
# Скрипт можно безопасно запускать повторно — он продолжит с места,
# где остановился, и не теряет ранее созданные пароли/ключи.
#
set -euo pipefail

# ============================ НАСТРОЙКИ ============================
DOMAIN="api.elenafromsochi-podari-012b.twc1.net"     # адрес базы (поддомен -> этот сервер)
LETSENCRYPT_EMAIL="visokihelenasochi@gmail.com"       # почта для SSL-сертификата
APP_SITE_URL="https://elenafromsochi-podari-012b.twc1.net"  # адрес приложения (для ссылок в письмах)
RAW_BASE="https://raw.githubusercontent.com/Elenafromsochi/podari/claude/podari-repo-overview-67zjks"
INSTALL_DIR="/opt/supabase"
SECRETS_FILE="/root/supabase-secrets.txt"
VARS_FILE="/root/.supabase-install-vars"
# ==================================================================

log()  { echo -e "\n\033[1;36m==> $*\033[0m"; }
warn() { echo -e "\033[1;33m[!] $*\033[0m"; }

if [ "$(id -u)" -ne 0 ]; then echo "Запусти скрипт из-под root."; exit 1; fi

# ---------- 1. Система + swap ----------
log "1/9  Обновляю систему и ставлю базовые пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl git openssl python3 python3-yaml jq ufw

log "Настраиваю файл подкачки (swap) на 2 ГБ"
if ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ---------- 2. Docker + зеркало ----------
log "2/9  Устанавливаю Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

log "Настраиваю зеркало Docker Hub (чтобы обойти лимит скачиваний)"
mkdir -p /etc/docker
if ! grep -q registry-mirrors /etc/docker/daemon.json 2>/dev/null; then
  cat > /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": ["https://dockerhub.timeweb.cloud", "https://huecker.io", "https://mirror.gcr.io"]
}
EOF
fi
systemctl enable docker
systemctl restart docker
sleep 3

# ---------- 3. Освобождаем порты 80/443 ----------
log "3/9  Останавливаю nginx (освобождаю порты для HTTPS)"
systemctl disable --now nginx 2>/dev/null || true

# ---------- 4. Скачиваем Supabase ----------
log "4/9  Скачиваю Supabase"
mkdir -p "$INSTALL_DIR"
if [ ! -f "$INSTALL_DIR/docker-compose.yml" ]; then
  tmp="$(mktemp -d)"
  git clone --depth 1 https://github.com/supabase/supabase "$tmp/supabase"
  cp -r "$tmp/supabase/docker/." "$INSTALL_DIR/"
  rm -rf "$tmp"
fi
cd "$INSTALL_DIR"
[ -f .env ] || cp .env.example .env

# ---------- 5. Секреты (создаём один раз, потом переиспользуем) ----------
log "5/9  Готовлю пароли и ключи доступа"
if [ -f "$VARS_FILE" ]; then
  # shellcheck disable=SC1090
  source "$VARS_FILE"
  echo "  Использую ранее созданные ключи."
else
  POSTGRES_PASSWORD="$(openssl rand -hex 24)"
  JWT_SECRET="$(openssl rand -hex 40)"
  SECRET_KEY_BASE="$(openssl rand -hex 32)"
  VAULT_ENC_KEY="$(openssl rand -hex 16)"
  DASHBOARD_USERNAME="admin"
  DASHBOARD_PASSWORD="$(openssl rand -hex 12)"
  gen_jwt() { # $1 = role
    python3 - "$JWT_SECRET" "$1" <<'PY'
import sys, hmac, hashlib, base64, json, time
secret, role = sys.argv[1], sys.argv[2]
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b'=')
header = b64(json.dumps({"alg":"HS256","typ":"JWT"}, separators=(',',':')).encode())
now = int(time.time())
payload = b64(json.dumps({"role":role,"iss":"supabase","iat":now,"exp":now+10*365*24*3600}, separators=(',',':')).encode())
sig = b64(hmac.new(secret.encode(), header+b'.'+payload, hashlib.sha256).digest())
print((header+b'.'+payload+b'.'+sig).decode())
PY
  }
  ANON_KEY="$(gen_jwt anon)"
  SERVICE_ROLE_KEY="$(gen_jwt service_role)"
  cat > "$VARS_FILE" <<EOF
POSTGRES_PASSWORD='$POSTGRES_PASSWORD'
JWT_SECRET='$JWT_SECRET'
SECRET_KEY_BASE='$SECRET_KEY_BASE'
VAULT_ENC_KEY='$VAULT_ENC_KEY'
DASHBOARD_USERNAME='$DASHBOARD_USERNAME'
DASHBOARD_PASSWORD='$DASHBOARD_PASSWORD'
ANON_KEY='$ANON_KEY'
SERVICE_ROLE_KEY='$SERVICE_ROLE_KEY'
EOF
  chmod 600 "$VARS_FILE"
fi

# ---------- 6. Прописываем .env ----------
log "6/9  Записываю настройки в .env"
export V_POSTGRES_PASSWORD="$POSTGRES_PASSWORD" V_JWT_SECRET="$JWT_SECRET" \
       V_ANON_KEY="$ANON_KEY" V_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
       V_SECRET_KEY_BASE="$SECRET_KEY_BASE" V_VAULT_ENC_KEY="$VAULT_ENC_KEY" \
       V_DASHBOARD_USERNAME="$DASHBOARD_USERNAME" V_DASHBOARD_PASSWORD="$DASHBOARD_PASSWORD" \
       V_SITE_URL="$APP_SITE_URL" V_DOMAIN="$DOMAIN"
python3 <<'PY'
import os, re
ov = {
 "POSTGRES_PASSWORD": os.environ["V_POSTGRES_PASSWORD"],
 "JWT_SECRET":        os.environ["V_JWT_SECRET"],
 "ANON_KEY":          os.environ["V_ANON_KEY"],
 "SERVICE_ROLE_KEY":  os.environ["V_SERVICE_ROLE_KEY"],
 "SECRET_KEY_BASE":   os.environ["V_SECRET_KEY_BASE"],
 "VAULT_ENC_KEY":     os.environ["V_VAULT_ENC_KEY"],
 "DASHBOARD_USERNAME":os.environ["V_DASHBOARD_USERNAME"],
 "DASHBOARD_PASSWORD":os.environ["V_DASHBOARD_PASSWORD"],
 "SITE_URL":          os.environ["V_SITE_URL"],
 "API_EXTERNAL_URL":  "https://"+os.environ["V_DOMAIN"],
 "SUPABASE_PUBLIC_URL":"https://"+os.environ["V_DOMAIN"],
 "ADDITIONAL_REDIRECT_URLS": os.environ["V_SITE_URL"],
 "ENABLE_EMAIL_SIGNUP": "true",
 "ENABLE_EMAIL_AUTOCONFIRM": "true",
 "DISABLE_SIGNUP": "false",
 "STUDIO_DEFAULT_ORGANIZATION": "Podari",
 "STUDIO_DEFAULT_PROJECT": "Podari",
 "POOLER_TENANT_ID": "podari",
}
d = open(".env").read()
for k, v in ov.items():
    if re.search(r'(?m)^'+re.escape(k)+r'=', d):
        d = re.sub(r'(?m)^'+re.escape(k)+r'=.*$', k+'='+v, d)
    else:
        d += ('' if d.endswith('\n') else '\n') + k+'='+v+'\n'
open(".env","w").write(d)
print("  .env обновлён")
PY

# ---------- 7. Безопасность: прячем внутренние порты ----------
log "7/9  Закрываю внутренние порты от интернета (оставляю наружу только HTTPS)"
python3 <<'PY'
import yaml
f = "docker-compose.yml"
d = yaml.safe_load(open(f))
for name, svc in (d.get("services") or {}).items():
    ports = svc.get("ports")
    if not ports:
        continue
    fixed = []
    for p in ports:
        s = str(p)
        if s.count(":") == 1 and not s.startswith("127.0.0.1"):
            fixed.append("127.0.0.1:" + s)
        else:
            fixed.append(p)
    svc["ports"] = fixed
yaml.safe_dump(d, open(f, "w"), sort_keys=False)
print("  внутренние порты привязаны к localhost")
PY

# ---------- 8. Запускаем Supabase ----------
log "8/9  Скачиваю образы Supabase (через зеркало, с повторами)"
ok=0
for attempt in 1 2 3 4 5 6; do
  if docker compose pull; then ok=1; break; fi
  warn "Загрузка не удалась, повтор №$attempt через 20 сек..."
  sleep 20
done
[ "$ok" = 1 ] || { warn "Образы скачать не удалось. Запусти скрипт ещё раз позже."; exit 1; }

log "Запускаю Supabase"
docker compose up -d

echo "  Жду готовности базы данных..."
ready=0
for i in $(seq 1 60); do
  if docker compose exec -T db pg_isready -U postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 5
done
[ "$ready" = 1 ] || warn "База долго не отвечает — проверь 'docker compose ps' позже."

log "Загружаю схему базы (16 таблиц) и создаю хранилища для картинок"
curl -fsSL "$RAW_BASE/supabase/full_schema.sql" -o /tmp/full_schema.sql
cat /tmp/full_schema.sql | docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=0 >/tmp/schema_apply.log 2>&1 || true
echo "  Готово (журнал: /tmp/schema_apply.log)"
docker compose exec -T db psql -U postgres -d postgres >/dev/null 2>&1 <<'SQL'
insert into storage.buckets (id, name, public) values
  ('gift-images','gift-images',true),
  ('admin-uploads','admin-uploads',false)
on conflict (id) do nothing;
SQL

# ---------- 9. HTTPS (Caddy) + файрвол ----------
log "9/9  Настраиваю HTTPS-сертификат (Caddy) и файрвол"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
    encode gzip
    reverse_proxy 127.0.0.1:8000
}
EOF
systemctl enable caddy
systemctl restart caddy

ufw allow 22/tcp >/dev/null 2>&1 || true
ufw allow 80/tcp >/dev/null 2>&1 || true
ufw allow 443/tcp >/dev/null 2>&1 || true
yes | ufw enable >/dev/null 2>&1 || true

# ---------- Итог ----------
{
  echo "==== ДОСТУПЫ SUPABASE (ХРАНИ В СЕКРЕТЕ) ===="
  echo "Дата установки: $(date)"
  echo "Адрес базы (URL):      https://$DOMAIN"
  echo "anon key (публичный):  $ANON_KEY"
  echo "service_role (тайный): $SERVICE_ROLE_KEY"
  echo "Пароль Postgres:       $POSTGRES_PASSWORD"
  echo "JWT secret:            $JWT_SECRET"
  echo "Studio логин:          $DASHBOARD_USERNAME"
  echo "Studio пароль:         $DASHBOARD_PASSWORD"
} > "$SECRETS_FILE"
chmod 600 "$SECRETS_FILE"

echo ""
echo -e "\033[1;32m================ УСТАНОВКА ЗАВЕРШЕНА ================\033[0m"
echo "Все доступы сохранены в файл: $SECRETS_FILE"
echo ""
echo "Адрес базы:        https://$DOMAIN"
echo "anon key:          $ANON_KEY"
echo ""
echo "Полные доступы (включая тайные ключи) показать командой:"
echo "   cat $SECRETS_FILE"
echo "===================================================="
