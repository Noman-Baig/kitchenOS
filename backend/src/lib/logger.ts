import pino from 'pino';
import { config } from '../config.js';

export const logger = pino({
  level: config.isTest ? 'silent' : config.logLevel,
  redact: {
    paths: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-customer-session"]', 'req.headers["x-csrf-token"]', '*.password', '*.password_hash', '*.token', '*.privateKey'],
    censor: '[redacted]',
  },
  base: { service: 'umemaai-backend' },
});
