#!/usr/bin/env bash
# Routine maintenance helpers.
#   bash scripts/maintenance.sh migrate        # apply new migrations after an update
#   bash scripts/maintenance.sh update         # rebuild after pulling a new release, then restart processes
#   bash scripts/maintenance.sh reset-admin you@example.com   # reset a Super Admin password (prompted)
set -euo pipefail
cd "$(dirname "$0")/.."
case "${1:-}" in
  migrate) ( cd backend && node dist/cli/migrate.js ) ;;
  update)
    npm --prefix backend ci && npm --prefix backend run build
    npm --prefix frontend ci && rm -rf frontend/.next && npm --prefix frontend run build
    ( cd backend && node dist/cli/migrate.js )
    command -v pm2 >/dev/null && pm2 reload deployment/pm2/ecosystem.config.cjs || echo "Restart your services (systemctl restart umema-api umema-worker umema-web)" ;;
  reset-admin) ( cd backend && node dist/cli/createSuperAdmin.js --email "${2:?email}" ) ;;
  *) echo "usage: $0 migrate|update|reset-admin <email>"; exit 1 ;;
esac
