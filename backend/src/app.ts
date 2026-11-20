import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { errorHandler } from './lib/http.js';
import { pool } from './lib/db.js';
import { csrf, loadUser } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { publicRouter } from './routes/public.js';
import { platformRouter } from './routes/platform.js';
import { restaurantRouter } from './routes/restaurant/index.js';
import { filesRouter } from './routes/files.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], imgSrc: ["'self'", 'data:'], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
  }));
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));
  app.use(cookieParser());
  if (!config.isTest) app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));

  // HTTPS enforcement behind a TLS-terminating proxy
  if (config.isProd) app.use((req, res, next) => (req.secure || req.path === '/api/health' ? next() : res.status(403).json({ error: { code: 'HTTPS_REQUIRED', message: 'HTTPS is required' } })));

  app.get('/api/health', async (_req, res) => {
    try { await pool.query('SELECT 1'); res.json({ status: 'ok', db: 'ok', time: new Date().toISOString() }); }
    catch { res.status(503).json({ status: 'degraded', db: 'unreachable' }); }
  });

  const globalLimiter = rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false });
  const v1 = express.Router();
  v1.use(globalLimiter);
  v1.use(loadUser);
  v1.use(csrf);
  v1.use('/auth', authRouter);
  v1.use('/public', publicRouter);
  v1.use('/files', filesRouter);
  v1.use('/platform', platformRouter);
  v1.use('/r', restaurantRouter);
  v1.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } }));
  app.use('/api/v1', v1);
  app.use(errorHandler);
  return app;
}
