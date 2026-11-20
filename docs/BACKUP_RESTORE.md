# Backup and Restore

## What is backed up

| Backup | File | Contents |
|---|---|---|
| Database | `BACKUP_DIR/db-<timestamp>.sql.gz` | `mysqldump --single-transaction --quick --routines --triggers --hex-blob` of the whole schema; verified by the dump-completion marker |
| Storage | `BACKUP_DIR/storage-<timestamp>.tar.gz` | Uploaded images, payment proofs, agreement PDFs, exports (the backup and temporary directories are excluded) |
| Restaurant export | `exports/…json.gz` | One restaurant's records, with secrets removed (on demand or before deletion) |

The `BACKUP_DIR` default is `backend/storage/backups`.

## Schedule and verification

- The worker runs both backups daily at `BACKUP_HOUR_UTC`. Each one can be switched on or off in **Admin → Branding & settings → Automations**.
- After each run, the file is:
  - checksummed (SHA-256)
  - test-read (`gunzip -t` for the database, `tar -tzf` for storage)
  - recorded in **Admin → Backups & operations** as *verified* or *failed*, with the error message
  Check this list regularly. A failed run also shows as a failed job.
- Manual run: **Run backup now** in the admin UI, or `bash scripts/backup.sh [database|storage|all]`.
- Retention: the newest 14 verified backups of each kind are kept and older ones are pruned automatically. Off-site copies keep your longer history.

## Off-site copies (strongly recommended)

Local backups do not protect against losing the server. Copy them off the server every day, for example:

```bash
rclone copy /opt/umemaai_undated_version/backend/storage/backups remote:umema-backups --max-age 2d
```

Encrypt them at rest (an rclone crypt remote, or bucket-side encryption). Keep the platform signing key backed up separately and offline.

## Restore

1. Stop the services: `pm2 stop all`, or `systemctl stop umema-api umema-worker umema-web`.
2. Compare the file's SHA-256 with the value shown in the admin backup list.
3. Restore:
   ```bash
   bash scripts/restore.sh database backend/storage/backups/db-<timestamp>.sql.gz
   bash scripts/restore.sh storage  backend/storage/backups/storage-<timestamp>.tar.gz
   ```
   The database restore applies any newer migrations afterwards.
4. Start the services and run `bash scripts/healthcheck.sh`.
5. All users will have to sign in again if the backup is older than their sessions.

### Rehearsal (do this quarterly)

1. Create an empty database `umema_restore`.
2. Run `DB_NAME=umema_restore bash scripts/restore.sh database <file>`.
3. Point a staging copy of the app at it.
4. Spot-check: a recent bill, the stock levels, the ledger health (`/r/ledger/health`).

## Point-in-time recovery (optional)

For installs that need more than daily granularity, enable MySQL binary logs (`log_bin`, `binlog_expire_logs_seconds=604800`). Restore the latest dump, then replay the binlogs up to the required time with `mysqlbinlog --stop-datetime`.
