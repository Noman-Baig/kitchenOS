import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { exec } from '../lib/db.js';
import { logger } from '../lib/logger.js';

async function sha256File(file: string) {
  const h = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), h);
  return h.digest('hex');
}

/** mysqldump → gzip. Verified by fully decompressing and checking the dump completion marker. */
async function databaseBackup(file: string) {
  const args = ['--single-transaction', '--quick', '--routines', '--triggers', '--hex-blob', `--host=${config.db.host}`, `--port=${config.db.port}`, `--user=${config.db.user}`, config.db.database];
  if (config.db.socketPath) args.splice(0, 0, `--socket=${config.db.socketPath}`);
  const child = spawn(config.backup.mysqldump, args, { env: { ...process.env, MYSQL_PWD: config.db.password } });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  const done = new Promise<void>((resolve, reject) => child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`mysqldump exited ${code}: ${stderr.slice(0, 500)}`)))));
  child.on('error', (e) => { stderr += e.message; });
  await Promise.all([pipeline(child.stdout, zlib.createGzip({ level: 6 }), fs.createWriteStream(file, { mode: 0o600 })), done]);
  // verify
  let tail = '';
  await pipeline(fs.createReadStream(file), zlib.createGunzip(), async function* (src) { for await (const chunk of src) { tail = (tail + chunk.toString()).slice(-400); } yield ''; });
  if (!/Dump completed/.test(tail)) throw new Error('Backup verification failed: dump completion marker missing');
}

/** tar-like archive of the storage directory (excluding backups and temporary files) using the system tar. */
async function storageBackup(file: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('tar', ['-czf', file, '--exclude=./backups', '--exclude=./temporary', '-C', config.storage.dir, '.']);
    let err = ''; child.stderr.on('data', (d) => (err += d));
    child.on('close', (c) => (c === 0 ? resolve() : reject(new Error(`tar exited ${c}: ${err}`))));
    child.on('error', reject);
  });
  await new Promise<void>((resolve, reject) => {
    const child = spawn('tar', ['-tzf', file]); child.stdout.resume();
    child.on('close', (c) => (c === 0 ? resolve() : reject(new Error('Storage archive verification failed'))));
    child.on('error', reject);
  });
}

export async function runBackupNow(kind: 'database' | 'storage') {
  await fsp.mkdir(config.backup.dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(config.backup.dir, kind === 'database' ? `db-${stamp}.sql.gz` : `storage-${stamp}.tar.gz`);
  const row = await exec("INSERT INTO backups (kind, file_path, status) VALUES (?,?,'running')", [kind, file]);
  try {
    if (kind === 'database') await databaseBackup(file); else await storageBackup(file);
    const stat = await fsp.stat(file);
    const sum = await sha256File(file);
    await exec("UPDATE backups SET status='verified', size_bytes=?, sha256=?, verified_at=NOW(3) WHERE id=?", [stat.size, sum, row.insertId]);
    return { id: row.insertId, file, size: stat.size, sha256: sum, status: 'verified' as const };
  } catch (err: any) {
    logger.error({ err }, 'backup failed');
    await exec("UPDATE backups SET status='failed', error=? WHERE id=?", [String(err.message).slice(0, 1000), row.insertId]);
    await fsp.unlink(file).catch(() => undefined);
    return { id: row.insertId, file, status: 'failed' as const, error: err.message as string };
  }
}

/** Keep the newest N verified backups of each kind. */
export async function pruneBackups(keep = 14) {
  const { q } = await import('../lib/db.js');
  for (const kind of ['database', 'storage']) {
    const old = await q<any>(`SELECT id, file_path FROM backups WHERE kind=? AND status='verified' ORDER BY id DESC LIMIT 100000 OFFSET ?`, [kind, keep]);
    for (const b of old) { await fsp.unlink(b.file_path).catch(() => undefined); await exec('DELETE FROM backups WHERE id=?', [b.id]); }
  }
}
