#!/usr/bin/env bash
# Manual / cron backup (database + storage), verified and recorded in Super Admin → Backups.
#   bash scripts/backup.sh            # both
#   bash scripts/backup.sh database   # database only
# Cron example (02:30 UTC daily, if the worker's built-in backup is disabled):
#   30 2 * * * cd /opt/umemaai_undated_version && bash scripts/backup.sh >> /var/log/umema-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/../backend"
node dist/cli/backup.js "${1:-all}"
# Off-site copy (recommended). Example with rclone:
#   rclone copy storage/backups remote:umema-backups --max-age 2d
