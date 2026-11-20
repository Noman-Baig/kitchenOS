import type { NextFunction, Request, Response, RequestHandler } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { AppError, badRequest } from './errors.js';

export const ah = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res, next).catch(next); };

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest('Validation failed', r.error.flatten());
  return r.data;
}

export function idParam(req: Request, name = 'id'): number {
  const v = Number(req.params[name]);
  if (!Number.isSafeInteger(v) || v <= 0) throw badRequest(`Invalid ${name}`);
  return v;
}

export function pageParams(req: Request) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 25));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) err = badRequest('Validation failed', err.flatten());
  if (err?.type === 'entity.too.large') err = new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  if (err?.code === 'LIMIT_FILE_SIZE') err = new AppError(413, 'FILE_TOO_LARGE', 'Uploaded file is too large');
  if (err?.code === 'ER_DUP_ENTRY') err = new AppError(409, 'DUPLICATE', 'A record with the same unique value already exists');
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  console.error('\n========== ACTUAL API ERROR ==========');
  console.error(err);
  console.error('Stack:', err?.stack);
  console.error('======================================\n');

  (req as any).log?.error({ err }, 'unhandled error');
  // (req as any).log?.error({ err }, 'unhandled error');
  if (process.env.DEBUG_ERRORS) console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'An unexpected error occurred' } });
}
