import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const e = process.env;
const here = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_ROOT = path.resolve(here, '..');
export const PROJECT_ROOT = path.resolve(BACKEND_ROOT, '..');

function num(v: string | undefined, d: number) {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== '' ? n : d;
}
function bool(v: string | undefined, d: boolean) {
  if (v === undefined || v === '') return d;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}
function list(v: string | undefined) {
  return (v || '').split(',').map((s) => s.trim()).filter(Boolean);
}

const env = e.NODE_ENV || 'development';
const isProd = env === 'production';

export const config = {
  env,
  isProd,
  isTest: env === 'test',
  port: num(e.PORT, 4000),
  appUrl: (e.APP_URL || 'http://192.168.100.198:3000').replace(/\/$/, ''),
  publicApiUrl: (e.PUBLIC_API_URL || e.APP_URL || 'http://192.168.100.198:3000').replace(/\/$/, ''),
  corsOrigins: list(e.CORS_ORIGINS).length ? list(e.CORS_ORIGINS) : [(e.APP_URL || 'http://192.168.100.198:3000').replace(/\/$/, '')],
  trustProxy: num(e.TRUST_PROXY, isProd ? 1 : 0),
  db: {
    host: e.DB_HOST || 'localhost',
    port: num(e.DB_PORT, 3306),
    user: e.DB_USER || 'root',
    password: e.DB_PASSWORD || 'minstrel',
    database: e.DB_NAME || 'restOS',
    connectionLimit: num(e.DB_POOL_SIZE, 15),
    socketPath: e.DB_SOCKET || undefined,
  },
  session: {
    ttlHours: num(e.SESSION_TTL_HOURS, 12),
    cookieName: 'um_sid',
    csrfCookieName: 'um_csrf',
    cookieSecure: bool(e.COOKIE_SECURE, isProd),
    cookieDomain: e.COOKIE_DOMAIN || undefined,
  },
  customerSession: {
    ttlHours: num(e.CUSTOMER_SESSION_TTL_HOURS, 8),
    cookieName: 'um_cust',
  },
  security: {
    maxFailedLogins: num(e.MAX_FAILED_LOGINS, 5),
    lockMinutes: num(e.LOCK_MINUTES, 15),
    fileSigningSecret: e.FILE_SIGNING_SECRET || (isProd ? '' : 'dev-file-signing-secret-change-me'),
    platformSigningKeyPath: e.PLATFORM_SIGNING_KEY_PATH || '',
    platformSigningKeyId: e.PLATFORM_SIGNING_KEY_ID || 'platform-key-1',
    platformPublicKeysDir: e.PLATFORM_PUBLIC_KEYS_DIR || '',
  },
  storage: {
    dir: path.resolve(BACKEND_ROOT, e.STORAGE_DIR || 'storage'),
    maxUploadMb: num(e.MAX_UPLOAD_MB, 8),
    imageMaxDimension: num(e.IMAGE_MAX_DIMENSION, 2400),
    imageMinDimension: num(e.IMAGE_MIN_DIMENSION, 64),
  },
  smtp: {
    host: e.SMTP_HOST || '',
    port: num(e.SMTP_PORT, 587),
    secure: bool(e.SMTP_SECURE, false),
    user: e.SMTP_USER || '',
    pass: e.SMTP_PASSWORD || '',
    from: e.SMTP_FROM || '',
  },
  redisUrl: e.REDIS_URL || '',
  runWorkerInApi: bool(e.RUN_WORKER_IN_API, !isProd),
  webrtc: {
    stunUrls: list(e.STUN_URLS).length ? list(e.STUN_URLS) : ['stun:stun.l.google.com:19302'],
    turnUrls: list(e.TURN_URLS),
    turnSecret: e.TURN_SECRET || '',
    turnTtlSeconds: num(e.TURN_TTL_SECONDS, 3600),
    callTimeoutSeconds: num(e.CALL_TIMEOUT_SECONDS, 30),
  },
  backup: {
    dir: path.resolve(BACKEND_ROOT, e.BACKUP_DIR || 'storage/backups'),
    mysqldump: e.MYSQLDUMP_PATH || 'mysqldump',
    hourUtc: num(e.BACKUP_HOUR_UTC, 2),
  },
  logLevel: e.LOG_LEVEL || (isProd ? 'info' : 'debug'),
};

export function assertProductionConfig() {
  if (!config.isProd) return;
  const missing: string[] = [];
  if (!config.db.password) missing.push('DB_PASSWORD');
  if (!config.security.fileSigningSecret || config.security.fileSigningSecret.length < 32) missing.push('FILE_SIGNING_SECRET (>=32 chars)');
  if (!config.appUrl.startsWith('https://')) missing.push('APP_URL must be https in production');
  if (missing.length) {
    throw new Error('Invalid production configuration: ' + missing.join(', '));
  }
}
