#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root" >&2
  exit 1
fi

repo_url="${PODARI_REPO_URL:-https://github.com/Elenafromsochi/podari.git}"
bootstrap_branch="${PODARI_BOOTSTRAP_BRANCH:-codex/staging-infrastructure}"
public_key_file="${PODARI_DEPLOY_PUBLIC_KEY_FILE:-/tmp/podari_staging_ci.pub}"
stage_dir=/opt/podari-staging
supabase_dir=/opt/supabase-staging
env_file=/etc/podari/staging.env

for command_name in caddy curl docker flock git node npm rsync sudo visudo; do
  command -v "$command_name" >/dev/null
done

test -s "$public_key_file"
systemctl is-active --quiet podari
systemctl is-active --quiet caddy
docker inspect --format '{{.State.Health.Status}}' supabase-db | grep -qx healthy

if ! id podari-deploy >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /home/podari-deploy --shell /bin/bash podari-deploy
fi

install -d -m 0750 -o podari-deploy -g podari-deploy "$stage_dir" "$stage_dir/releases"
install -d -m 0750 -o root -g podari-deploy /etc/podari

if [ ! -d "$stage_dir/source/.git" ]; then
  git clone --branch "$bootstrap_branch" "$repo_url" "$stage_dir/source"
fi
chown -R podari-deploy:podari-deploy "$stage_dir"

install -m 0755 -o root -g root \
  "$stage_dir/source/deploy/deploy-staging.sh" /usr/local/sbin/podari-staging-deploy
install -m 0644 -o root -g root \
  "$stage_dir/source/deploy/podari-staging.service" /etc/systemd/system/podari-staging.service
install -m 0755 -o root -g root \
  "$stage_dir/source/deploy/backup-production.sh" /usr/local/sbin/podari-production-backup
install -m 0644 -o root -g root \
  "$stage_dir/source/deploy/podari-backup.service" /etc/systemd/system/podari-backup.service
install -m 0644 -o root -g root \
  "$stage_dir/source/deploy/podari-backup.timer" /etc/systemd/system/podari-backup.timer

install -d -m 0700 -o podari-deploy -g podari-deploy /home/podari-deploy/.ssh
deploy_key="$(tr -d '\r\n' < "$public_key_file")"
printf 'restrict,command="/usr/local/sbin/podari-staging-deploy" %s\n' "$deploy_key" \
  > /home/podari-deploy/.ssh/authorized_keys
chown podari-deploy:podari-deploy /home/podari-deploy/.ssh/authorized_keys
chmod 0600 /home/podari-deploy/.ssh/authorized_keys

cat > /etc/sudoers.d/podari-staging-deploy <<'EOF'
podari-deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart podari-staging
EOF
chmod 0440 /etc/sudoers.d/podari-staging-deploy
visudo -cf /etc/sudoers.d/podari-staging-deploy >/dev/null

set_env() {
  file="$1"
  key="$2"
  value="$3"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*$|${key}=${value}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

if [ ! -f "$supabase_dir/.env" ]; then
  mkdir -p "$supabase_dir"
  rsync -a \
    --exclude='.env' \
    --exclude='.env.old' \
    --exclude='volumes/db/data' \
    --exclude='volumes/storage' \
    /opt/supabase/ "$supabase_dir/"
  cp "$supabase_dir/.env.example" "$supabase_dir/.env"

  sed -i \
    -e 's|^name: supabase$|name: supabase-staging|' \
    -e 's|container_name: supabase-|container_name: podari-staging-|g' \
    -e 's|container_name: realtime-dev.supabase-realtime|container_name: podari-staging-realtime|' \
    -e 's|/opt/supabase/|/opt/supabase-staging/|g' \
    -e 's|127.0.0.1:${POSTGRES_PORT}:5432|127.0.0.1:5532:5432|' \
    -e 's|127.0.0.1:${POOLER_PROXY_PORT_TRANSACTION}:6543|127.0.0.1:6544:6543|' \
    "$supabase_dir/docker-compose.yml"

  set_env "$supabase_dir/.env" SUPABASE_PUBLIC_URL https://api-stage.23podari.ru
  set_env "$supabase_dir/.env" API_EXTERNAL_URL https://api-stage.23podari.ru
  set_env "$supabase_dir/.env" SITE_URL https://stage.23podari.ru
  set_env "$supabase_dir/.env" ADDITIONAL_REDIRECT_URLS 'https://stage.23podari.ru/**'
  set_env "$supabase_dir/.env" KONG_HTTP_PORT 8100
  set_env "$supabase_dir/.env" KONG_HTTPS_PORT 8543
  set_env "$supabase_dir/.env" POOLER_TENANT_ID podari-staging
  set_env "$supabase_dir/.env" STORAGE_TENANT_ID podari-staging
  set_env "$supabase_dir/.env" STUDIO_DEFAULT_ORGANIZATION Podari
  set_env "$supabase_dir/.env" STUDIO_DEFAULT_PROJECT Staging
  set_env "$supabase_dir/.env" ENABLE_EMAIL_SIGNUP false
  set_env "$supabase_dir/.env" ENABLE_PHONE_SIGNUP false
  set_env "$supabase_dir/.env" ENABLE_PHONE_AUTOCONFIRM false
  set_env "$supabase_dir/.env" OPENAI_API_KEY ''
  set_env "$supabase_dir/.env" SMTP_PASS disabled

  (
    cd "$supabase_dir"
    sh utils/generate-keys.sh --update-env >/dev/null
    rm -f .env.old
  )
  chmod 0600 "$supabase_dir/.env"
fi

anon_key="$(sed -n 's/^ANON_KEY=//p' "$supabase_dir/.env" | head -1)"
service_key="$(sed -n 's/^SERVICE_ROLE_KEY=//p' "$supabase_dir/.env" | head -1)"
test -n "$anon_key"
test -n "$service_key"

cat > "$env_file" <<EOF
VITE_APP_ENV=staging
VITE_SUPABASE_URL=https://api-stage.23podari.ru
VITE_SUPABASE_PUBLISHABLE_KEY=$anon_key
SUPABASE_URL=http://127.0.0.1:8100
SUPABASE_PUBLISHABLE_KEY=$anon_key
SUPABASE_SERVICE_ROLE_KEY=$service_key
APP_URL=https://stage.23podari.ru
DISABLE_BACKGROUND_JOBS=1
PORT=3100
HOST=127.0.0.1
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_WEBHOOK_SECRET=
AI_API_KEY=
EOF
chown root:podari-deploy "$env_file"
chmod 0640 "$env_file"

(
  cd "$supabase_dir"
  docker compose config >/dev/null
  docker compose up -d
)

for attempt in $(seq 1 60); do
  if docker inspect --format '{{.State.Health.Status}}' podari-staging-db 2>/dev/null | grep -qx healthy; then
    break
  fi
  sleep 2
done
docker inspect --format '{{.State.Health.Status}}' podari-staging-db | grep -qx healthy

if ! docker exec podari-staging-db psql -U postgres -d postgres -Atqc \
  "select to_regclass('public.profiles') is not null" | grep -qx t; then
  docker exec -i podari-staging-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
    < "$stage_dir/source/supabase/full_schema.sql"
fi

(
  cd "$supabase_dir"
  docker compose stop studio meta functions supavisor
)

if ! grep -q '^# BEGIN PODARI STAGING$' /etc/caddy/Caddyfile; then
  cat >> /etc/caddy/Caddyfile <<'EOF'

# BEGIN PODARI STAGING
stage.23podari.ru {
    encode gzip
    header X-Robots-Tag "noindex, nofollow"
    reverse_proxy 127.0.0.1:3100
}

api-stage.23podari.ru {
    encode gzip
    header X-Robots-Tag "noindex, nofollow"
    reverse_proxy 127.0.0.1:8100
}
# END PODARI STAGING
EOF
fi
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy

systemctl daemon-reload
systemctl enable podari-staging podari-backup.timer
systemctl start podari-backup.timer

PODARI_DEPLOY_BRANCH="$bootstrap_branch" \
  sudo -u podari-deploy /usr/local/sbin/podari-staging-deploy

curl -fsS http://127.0.0.1:8100/auth/v1/health >/dev/null
curl -fsS http://127.0.0.1:3100/ >/dev/null
systemctl is-active --quiet podari caddy podari-staging

echo STAGING_SETUP_OK
