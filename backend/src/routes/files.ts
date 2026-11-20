import { Router } from 'express';
import { ah } from '../lib/http.js';
import { forbidden, notFound } from '../lib/errors.js';
import { verifyFileSignature } from '../lib/crypto.js';
import { hasPermission } from '../lib/permissions.js';
import { getFileRow, fileExists, absPath } from '../services/storage.js';
import { findSessionByToken } from '../middleware/customer.js';

/**
 * File delivery. Public images (logos, menu photos) are served by unguessable UUID with caching.
 * Private files (payment proofs, signatures, exports, PDFs) require: a valid short-lived signature, OR
 * an authenticated staff user of the same tenant with billing/subscription rights, OR the customer session that uploaded it.
 * Storage paths are never exposed.
 */
export const filesRouter = Router();

filesRouter.get('/:publicId', ah(async (req, res) => {
  const f = await getFileRow(req.params.publicId);
  if (!f) throw notFound('File');
  const key = req.query.thumb === '1' && f.thumb_key ? f.thumb_key : f.storage_key;
  if (!fileExists(key)) throw notFound('File');
  if (f.visibility === 'public') {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.type(f.mime);
    return res.sendFile(absPath(key));
  }
  let allowed = false;
  if (typeof req.query.sig === 'string' && typeof req.query.exp === 'string') allowed = verifyFileSignature(f.public_id, req.query.exp, req.query.sig);
  const u = req.user;
  if (!allowed && u) {
    if (u.isSuperAdmin) allowed = true;
    else if (f.restaurant_id && u.restaurantId === f.restaurant_id && (hasPermission(u.permissions, 'payments.approve') || hasPermission(u.permissions, 'subscription.manage') || hasPermission(u.permissions, 'reports.view'))) allowed = true;
  }
  if (!allowed && f.owner_session_id) {
    const s = await findSessionByToken(req.get('x-customer-session') || '');
    if (s && s.id === f.owner_session_id) allowed = true;
  }
  if (!allowed) throw forbidden('Access to this file is restricted');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.type(f.mime);
  res.sendFile(absPath(key));
}));
