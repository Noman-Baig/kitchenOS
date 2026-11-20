import type { NextFunction, Request, Response } from 'express';
import { exec, one } from '../lib/db.js';
import { sha256 } from '../lib/crypto.js';
import { ah } from '../lib/http.js';
import { suspended, unauthorized } from '../lib/errors.js';
import { computeAvailability, suspensionInfo } from '../services/restaurantStatus.js';

export async function findSessionByToken(token: string) {
  if (!token || token.length > 200) return null;
  return one<any>(
    `SELECT cs.* FROM customer_session_tokens t JOIN customer_sessions cs ON cs.id=t.session_id
      WHERE t.token_hash=? AND t.revoked_at IS NULL`, [sha256(token)]);
}

/** Customer session from the opaque `x-customer-session` header. Re-checks restaurant status on every request. */
export const requireCustomer = ah(async (req: Request, _res: Response, next: NextFunction) => {
  const token = req.get('x-customer-session') || '';
  const s = await findSessionByToken(token);
  if (!s) throw unauthorized('Your table session has ended. Please scan the QR code again.');
  const r = await one<any>('SELECT * FROM restaurants WHERE id=?', [s.restaurant_id]);
  const a = await computeAvailability(r);
  if (!a.available) throw suspended('This restaurant is not accepting orders right now', await suspensionInfo(r, a));
  if (s.status === 'active' && new Date(s.expires_at).getTime() < Date.now()) {
    await exec("UPDATE customer_sessions SET status='expired' WHERE id=?", [s.id]);
    s.status = 'expired';
  }
  req.customer = { sessionId: s.id, restaurantId: s.restaurant_id, tableId: s.table_id, kind: s.kind, customerId: s.customer_id, name: s.customer_name, billId: s.bill_id, status: s.status };
  (req as any).customerSession = s;
  req.restaurant = r;
  if (Date.now() - new Date(s.last_seen_at).getTime() > 30_000) exec('UPDATE customer_sessions SET last_seen_at=NOW(3) WHERE id=?', [s.id]).catch(() => undefined);
  next();
});

export function requireActiveCustomer(req: Request, _res: Response, next: NextFunction) {
  if (req.customer?.status !== 'active') return next(unauthorized('This session is closed. Scan the QR code again to start a new one.'));
  next();
}
