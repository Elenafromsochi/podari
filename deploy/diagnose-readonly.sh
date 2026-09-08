#!/usr/bin/env bash
# Inventory only: no deploy, restart, SQL, webhook changes or secret values.
# Run on the actual application server, not on a newly created VPS.
set -uo pipefail

section() { printf '\n== %s ==\n' "$1"; }
APP_DIR="${1:-/opt/podari}"

section 'UTC time and application checkout'
date -u '+%Y-%m-%dT%H:%M:%SZ'
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" rev-parse HEAD
  git -C "$APP_DIR" status --short
  git -C "$APP_DIR" log -1 --format='%h %cs %s'
else
  printf 'No Git checkout at %s; locate the actual application directory.\n' "$APP_DIR"
fi

section 'Services (no environment values)'
systemctl is-active podari caddy docker || true
systemctl show podari -p FragmentPath -p WorkingDirectory -p MainPID -p ActiveState -p SubState -p TimeoutStopUSec -p ExecMainStartTimestamp || true

section 'Runtime and disk'
node --version || true
df -h / "$APP_DIR" 2>/dev/null || true

section 'Build entry and timestamps'
for path in "$APP_DIR/dist/server/index.mjs" "$APP_DIR/dist/client" /etc/caddy/Caddyfile; do
  if [ -e "$path" ]; then stat -c '%y %n' "$path"; fi
done
if [ -f "$APP_DIR/dist/server/index.mjs" ]; then sha256sum "$APP_DIR/dist/server/index.mjs"; fi

section 'Configured env variable names only (values omitted)'
if [ -f "$APP_DIR/.env" ]; then
  sed -nE 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=.*/\2=<configured>/p' "$APP_DIR/.env" | sort
fi

section 'Docker inventory and persistent mounts'
if command -v docker >/dev/null 2>&1; then
  docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' || true
  # Only mount paths, never container environment or database contents.
  while IFS= read -r container; do
    [ -n "$container" ] || continue
    docker inspect --format '{{.Name}}{{range .Mounts}}{{printf "\n  %s -> %s (%s)" .Source .Destination .Type}}{{end}}' "$container" || true
  done < <(docker ps -a --format '{{.Names}}' | grep -E 'supabase|podari' || true)
fi

section 'Local HTTP reachability (status only)'
for endpoint in http://127.0.0.1:3000/ http://127.0.0.1:8000/auth/v1/health; do
  curl -sS --max-time 10 -o /dev/null -w "$endpoint => HTTP %{http_code}\n" "$endpoint" || true
done
printf '401 from Supabase without an API key can be normal gateway behavior.\n'

section 'Known application error counts in last 24 hours (raw logs omitted)'
journalctl -u podari --since '24 hours ago' --no-pager -o cat 2>/dev/null |
  awk '
    /duplex option is required/ {duplex++}
    /NONCE_CREATE_FAILED/ {nonce++}
    /SIGNIN_FAILED/ {signin++}
    /TELEGRAM_SEND_FAILED/ {telegram++}
    /Missing Supabase environment/ {env++}
    END {
      printf "duplex=%d nonce_create=%d signin=%d telegram_send=%d missing_env=%d\n", duplex, nonce, signin, telegram, env
    }'
printf '\nFinished inventory. No services or data were changed.\n'
