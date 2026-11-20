import { pool } from '../lib/db.js';
import { runBackupNow, pruneBackups } from '../jobs/backup.js';

/** Manual/cron backup: node dist/cli/backup.js [database|storage|all] */
const kind = process.argv[2] || 'all';
const kinds = kind === 'all' ? (['database', 'storage'] as const) : [kind as 'database' | 'storage'];
let failed = false;
for (const k of kinds) {
  const r = await runBackupNow(k);
  console.log(JSON.stringify(r));
  if (r.status !== 'verified') failed = true;
}
await pruneBackups();
await pool.end();
process.exit(failed ? 1 : 0);
