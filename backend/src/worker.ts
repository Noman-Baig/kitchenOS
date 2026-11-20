import { assertProductionConfig } from './config.js';
import { logger } from './lib/logger.js';
import { pool } from './lib/db.js';
import { ensureStorageDirs } from './services/storage.js';
import { initWorkerEmitter } from './realtime/bus.js';
import { startScheduler } from './jobs/scheduler.js';

assertProductionConfig();
await ensureStorageDirs();
initWorkerEmitter();
const stop = startScheduler();
logger.info('background worker started');

const shutdown = async () => { stop(); await pool.end().catch(() => undefined); process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
