#!/usr/bin/env bash
set -euo pipefail

base_dir=/opt/podari-staging
source_dir="$base_dir/source"
releases_dir="$base_dir/releases"
env_file=/etc/podari/staging.env
lock_file="$base_dir/deploy.lock"

exec 9>"$lock_file"
flock -n 9 || { echo "Staging deployment is already running"; exit 1; }

test -r "$env_file"
deploy_branch="${PODARI_DEPLOY_BRANCH:-staging}"
git -C "$source_dir" fetch --prune origin "$deploy_branch"
revision="$(git -C "$source_dir" rev-parse "origin/$deploy_branch")"
release_dir="$releases_dir/$revision"
previous_target="$(readlink -f "$base_dir/current" 2>/dev/null || true)"

if [ ! -d "$release_dir" ]; then
  mkdir -p "$release_dir"
  git -C "$source_dir" archive "$revision" | tar -x -C "$release_dir"
  cd "$release_dir"
  npm install --no-audit --no-fund
  set -a
  # shellcheck disable=SC1090
  . "$env_file"
  set +a
  NITRO_PRESET=node-server npm run build
fi

ln -sfn "$release_dir" "$base_dir/current.new"
mv -Tf "$base_dir/current.new" "$base_dir/current"

if ! sudo -n systemctl restart podari-staging; then
  if [ -n "$previous_target" ]; then
    ln -sfn "$previous_target" "$base_dir/current"
    sudo -n systemctl restart podari-staging || true
  fi
  exit 1
fi

for attempt in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3100/ >/dev/null; then
    echo "STAGING_DEPLOYED=$revision"
    exit 0
  fi
  sleep 1
done

echo "Staging health check failed" >&2
if [ -n "$previous_target" ]; then
  ln -sfn "$previous_target" "$base_dir/current"
  sudo -n systemctl restart podari-staging || true
fi
exit 1
