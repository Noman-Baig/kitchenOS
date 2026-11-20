import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import { config, PROJECT_ROOT } from '../config.js';

/** Versioned SQL migrations from /database/migrations. Each file runs once, in order; checksums detect edits. */
export async function migrate(log = console.log) {
  const conn = await mysql.createConnection({ host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password, database: config.db.database, socketPath: config.db.socketPath, multipleStatements: true });
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(190) PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB`);
    const dir = path.join(PROJECT_ROOT, 'database', 'migrations');
    const files = (await fs.readdir(dir)).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
    const [rows] = await conn.query('SELECT version, checksum FROM schema_migrations');
    const applied = new Map((rows as any[]).map((r) => [r.version, r.checksum]));
    for (const f of files) {
      const sql = await fs.readFile(path.join(dir, f), 'utf8');
      const sum = crypto.createHash('sha256').update(sql).digest('hex');
      if (applied.has(f)) {
        if (applied.get(f) !== sum) throw new Error(`Migration ${f} was modified after being applied. Create a new migration instead.`);
        continue;
      }
      log(`applying ${f}`);
      await conn.query(sql);
      await conn.query('INSERT INTO schema_migrations (version, checksum) VALUES (?,?)', [f, sum]);
    }
    log('migrations up to date');
  } finally {
    await conn.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
}
