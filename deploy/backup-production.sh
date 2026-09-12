#!/usr/bin/env bash
set -euo pipefail

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="/opt/backups/podari/$stamp"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"

git -C /opt/podari bundle create "$backup_dir/repository.bundle" --all
tar -C /opt/podari -czf "$backup_dir/app-state.tar.gz" \
  .env dist package.json deploy
tar -C / -czf "$backup_dir/runtime-config.tar.gz" \
  etc/caddy/Caddyfile etc/caddy/certs etc/systemd/system/podari.service
tar -C /opt/supabase -czf "$backup_dir/supabase-config.tar.gz" \
  --exclude='./volumes/db/data' --exclude='./volumes/storage' \
  .env docker-compose.yml volumes/api volumes/db volumes/pooler
docker exec supabase-db pg_dump -U postgres -d postgres -Fc \
  > "$backup_dir/postgres.dump"
tar -C /opt/supabase/volumes -czf "$backup_dir/storage.tar.gz" storage

(
  cd "$backup_dir"
  sha256sum repository.bundle app-state.tar.gz runtime-config.tar.gz \
    supabase-config.tar.gz postgres.dump storage.tar.gz > SHA256SUMS
  sha256sum -c SHA256SUMS
)
git -C /opt/podari bundle verify "$backup_dir/repository.bundle" >/dev/null
docker exec -i supabase-db pg_restore -l < "$backup_dir/postgres.dump" >/dev/null
tar -tzf "$backup_dir/app-state.tar.gz" >/dev/null
tar -tzf "$backup_dir/runtime-config.tar.gz" >/dev/null
tar -tzf "$backup_dir/supabase-config.tar.gz" >/dev/null
tar -tzf "$backup_dir/storage.tar.gz" >/dev/null
chmod 600 "$backup_dir"/*
echo "BACKUP_OK=$backup_dir"
