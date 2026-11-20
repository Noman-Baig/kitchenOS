#!/usr/bin/env bash
# Restore a verified backup.  STOP the API, worker and web processes first.
#   bash scripts/restore.sh database backend/storage/backups/db-2026-....sql.gz
#   bash scripts/restore.sh storage  backend/storage/backups/storage-2026-....tar.gz
# Use a separate empty database first to rehearse (set DB_NAME in the environment), then switch over.
set -euo pipefail
cd "$(dirname "$0")/.."
KIND="${1:?database|storage}"; FILE="${2:?path to backup file}"
[ -f "$FILE" ] || { echo "No such file: $FILE"; exit 1; }
OVERRIDE_DB_NAME="${DB_NAME:-}"
set -a; . backend/.env; set +a
[ -n "$OVERRIDE_DB_NAME" ] && DB_NAME="$OVERRIDE_DB_NAME"
echo "SHA-256: $(sha256sum "$FILE" | cut -d' ' -f1)  (compare with Super Admin → Backups)"
read -r -p "Restore $KIND from $FILE into ${DB_NAME:-umema}? Type RESTORE to continue: " OK
[ "$OK" = "RESTORE" ] || { echo "Aborted"; exit 1; }
if [ "$KIND" = "database" ]; then
  gunzip -t "$FILE"
  gunzip -c "$FILE" | MYSQL_PWD="$DB_PASSWORD" mysql -h "${DB_HOST:-127.0.0.1}" -P "${DB_PORT:-3306}" -u "$DB_USER" "$DB_NAME"
  ( cd backend && DB_NAME="$DB_NAME" node dist/cli/migrate.js )   # applies any newer migrations
elif [ "$KIND" = "storage" ]; then
  tar -tzf "$FILE" >/dev/null
  mkdir -p backend/storage
  tar -xzf "$FILE" -C backend/storage
else
  echo "Unknown kind: $KIND"; exit 1
fi
echo "Restore finished. Start the services and run: bash scripts/healthcheck.sh"
