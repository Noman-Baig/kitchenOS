import http from 'node:http';
import { assertProductionConfig, config } from './config.js';
import { createApp } from './app.js';
import { createRealtime } from './realtime/socket.js';
import { logger } from './lib/logger.js';
import { pool } from './lib/db.js';
import { ensureStorageDirs } from './services/storage.js';
import { startScheduler } from './jobs/scheduler.js';

assertProductionConfig();
await ensureStorageDirs();
const app = createApp();
const server = http.createServer(app);
server.requestTimeout = 60_000;
server.headersTimeout = 65_000;
await createRealtime(server);
server.listen(config.port, () => logger.info({ port: config.port, env: config.env }, 'API listening'));

let stopScheduler: (() => void) | null = null;
if (config.runWorkerInApi) stopScheduler = startScheduler();

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  stopScheduler?.();
  server.close(() => undefined);
  setTimeout(() => process.exit(0), 8000).unref();
  await pool.end().catch(() => undefined);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
