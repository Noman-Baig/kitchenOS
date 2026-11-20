import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { exec, j, one } from '../lib/db.js';
import { sha256, safeEqual } from '../lib/crypto.js';
import { forbidden, unauthorized, suspended } from '../lib/errors.js';
import { hasPermission, type Permission } from '../lib/permissions.js';
import { ah } from '../lib/http.js';
import { computeAvailability, suspensionInfo } from '../services/restaurantStatus.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Loads the staff/super-admin session from the HttpOnly cookie. Never trusts client-supplied identity. */
export const loadUser = ah(async (req: Request, _res: Response, next: NextFunction) => {
  const token = req.cookies?.[config.session.cookieName];
  if (!token || typeof token !== 'string' || token.length > 200) return next();
  const row = await one<any>(
    `SELECT s.id sid, s.csrf_token, s.expires_at, s.last_seen_at, u.id, u.email, u.name, u.is_super_admin, u.restaurant_id, u.branch_id, u.role_id, u.active,
            r.name role_name, r.permissions
       FROM auth_sessions s JOIN users u ON u.id=s.user_id LEFT JOIN roles r ON r.id=u.role_id
      WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>NOW(3)`,
    [sha256(token)],
  );
  if (!row || !row.active) return next();
  req.user = {
    id: row.id, sessionId: row.sid, email: row.email, name: row.name, isSuperAdmin: !!row.is_super_admin,
    restaurantId: row.restaurant_id, branchId: row.branch_id, roleId: row.role_id, roleName: row.role_name,
    permissions: row.is_super_admin ? ['*'] : j<string[]>(row.permissions, []), csrfToken: row.csrf_token,
  };
  if (Date.now() - new Date(row.last_seen_at).getTime() > 60_000) {
    exec('UPDATE auth_sessions SET last_seen_at=NOW(3) WHERE id=?', [row.sid]).catch(() => undefined);
  }
  next();
});

/** Double-submit CSRF protection for cookie-authenticated state-changing requests. */
export function csrf(req: Request, _res: Response, next: NextFunction) {
  if (SAFE.has(req.method) || !req.user) return next();
  const header = req.get('x-csrf-token') || '';
  if (!header || !safeEqual(header, req.user.csrfToken)) return next(forbidden('Invalid or missing CSRF token'));
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  if (!req.user.isSuperAdmin) return next(forbidden('Super Admin access required'));
  next();
}

/** Staff of an active restaurant. Tenant id always comes from the server-side session. */
export const requireTenant = ah(async (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) throw unauthorized();
  if (!req.user.restaurantId) throw forbidden('This endpoint is for restaurant accounts');
  const r = await one<any>('SELECT * FROM restaurants WHERE id=?', [req.user.restaurantId]);
  if (!r) throw forbidden();
  const a = await computeAvailability(r);
  // Owners/admins may still reach subscription & export endpoints to renew; everything else is blocked.
  const renewalPath = /^\/(subscription|agreements|me|export|status)(\/|$)/.test(req.path);
  if (!a.available && !(renewalPath && hasPermission(req.user.permissions, 'subscription.manage' as Permission))) {
    throw suspended('Restaurant account is not active', await suspensionInfo(r, a));
  }
  req.restaurant = { ...r, availability: a };
  next();
});

export function requirePerm(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!perms.some((p) => hasPermission(req.user!.permissions, p))) return next(forbidden(`Missing permission: ${perms.join(' or ')}`));
    next();
  };
}
