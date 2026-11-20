import { Router, type Response } from 'express';
import argon2 from 'argon2';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { exec, one, q, toJson, tx } from '../lib/db.js';
import { ah, parse } from '../lib/http.js';
import { badRequest, conflict, unauthorized } from '../lib/errors.js';
import { randomToken, sha256, uuid } from '../lib/crypto.js';
import { audit } from '../lib/audit.js';
import { DEFAULT_ROLES } from '../lib/permissions.js';
import { isValidCurrency } from '../lib/money.js';
import { requireAuth } from '../middleware/auth.js';
import { DEFAULT_RESTAURANT_SETTINGS, getBranding } from '../services/settings.js';
import { computeAvailability, suspensionInfo } from '../services/restaurantStatus.js';
import { acceptAgreement } from '../services/agreements.js';
import { emailEnabled, notify, sendEmail, superAdminEmails } from '../services/notify.js';

export const ARGON = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
export const hashPassword = (p: string) => argon2.hash(p, ARGON);
export const zPassword = z.string().min(10, 'Password must be at least 10 characters').max(128)
  .refine((p) => /[a-zA-Z]/.test(p) && /\d/.test(p), 'Password must contain letters and numbers');

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again later.' } } });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false });

export function setSessionCookies(res: Response, token: string, csrf: string) {
  const base = { secure: config.session.cookieSecure, sameSite: 'lax' as const, domain: config.session.cookieDomain, path: '/', maxAge: config.session.ttlHours * 3600 * 1000 };
  res.cookie(config.session.cookieName, token, { ...base, httpOnly: true });
  res.cookie(config.session.csrfCookieName, csrf, { ...base, httpOnly: false });
}

export async function createSession(userId: number, ip: string | undefined, ua: string | undefined) {
  const token = randomToken(32);
  const csrf = randomToken(32);
  await exec('INSERT INTO auth_sessions (user_id, token_hash, csrf_token, ip_address, user_agent, expires_at) VALUES (?,?,?,?,?,DATE_ADD(NOW(3), INTERVAL ? HOUR))',
    [userId, sha256(token), csrf, ip ?? null, (ua || '').slice(0, 400), config.session.ttlHours]);
  return { token, csrf };
}

// constant-time-ish: always run a hash verification even for unknown users
const DUMMY_HASH = await argon2.hash('dummy-password-for-timing', ARGON);

export const authRouter = Router();

authRouter.post('/login', loginLimiter, ah(async (req, res) => {
  const body = parse(z.object({ email: z.string().email().max(190), password: z.string().min(1).max(200) }), req.body);
  const email = body.email.toLowerCase();
  const user = await one<any>('SELECT * FROM users WHERE email=?', [email]);
  if (user?.locked_until && new Date(user.locked_until) > new Date()) {
    await argon2.verify(DUMMY_HASH, body.password).catch(() => false);
    throw unauthorized('Account temporarily locked after repeated failed attempts. Try again later.');
  }
  const ok = user ? await argon2.verify(user.password_hash, body.password).catch(() => false) : await argon2.verify(DUMMY_HASH, body.password).catch(() => false) && false;
  if (!user || !ok || !user.active) {
    if (user) {
      const fails = user.failed_logins + 1;
      const lock = fails >= config.security.maxFailedLogins;
      await exec('UPDATE users SET failed_logins=?, locked_until=? WHERE id=?', [lock ? 0 : fails, lock ? new Date(Date.now() + config.security.lockMinutes * 60000) : null, user.id]);
      await audit({ type: 'system', ip: req.ip }, lock ? 'auth.locked' : 'auth.failed', 'user', user.id, {}, undefined, user.restaurant_id);
    }
    throw unauthorized('Invalid email or password');
  }
  if (argon2.needsRehash(user.password_hash, ARGON)) await exec('UPDATE users SET password_hash=? WHERE id=?', [await hashPassword(body.password), user.id]);
  await exec('UPDATE users SET failed_logins=0, locked_until=NULL, last_login_at=NOW(3) WHERE id=?', [user.id]);
  const { token, csrf } = await createSession(user.id, req.ip, req.get('user-agent'));
  setSessionCookies(res, token, csrf);
  await audit({ type: user.is_super_admin ? 'super_admin' : 'staff', userId: user.id, ip: req.ip }, 'auth.login', 'user', user.id, {}, undefined, user.restaurant_id);
  res.json({ ok: true, csrfToken: csrf, isSuperAdmin: !!user.is_super_admin });
}));

authRouter.post('/logout', ah(async (req, res) => {
  if (req.user) await exec('UPDATE auth_sessions SET revoked_at=NOW(3) WHERE id=?', [req.user.sessionId]);
  res.clearCookie(config.session.cookieName, { path: '/', domain: config.session.cookieDomain });
  res.clearCookie(config.session.csrfCookieName, { path: '/', domain: config.session.cookieDomain });
  res.json({ ok: true });
}));

authRouter.get('/me', ah(async (req, res) => {
  if (!req.user) return res.json({ user: null });
  const u = req.user;
  let restaurant: any = null;
  if (u.restaurantId) {
    const r = await one<any>('SELECT id, public_id, slug, name, currency, timezone, locale, country, status, subscription_expires_at, logo_file_id, settings, plan_id FROM restaurants WHERE id=?', [u.restaurantId]);
    const a = await computeAvailability(r);
    const logo = r.logo_file_id ? await one<any>('SELECT public_id FROM files WHERE id=?', [r.logo_file_id]) : null;
    const pendingAgreement = await one<any>(
      `SELECT a.id, a.version, a.title FROM agreements a WHERE a.is_current=1 AND a.is_material=1
         AND NOT EXISTS (SELECT 1 FROM agreement_acceptances x WHERE x.agreement_id=a.id AND x.restaurant_id=?)`, [r.id]);
    restaurant = {
      id: r.id, slug: r.slug, name: r.name, currency: r.currency, timezone: r.timezone, locale: r.locale, country: r.country,
      logoUrl: logo ? `/api/v1/files/${logo.public_id}` : null, availability: a, suspension: a.available ? null : await suspensionInfo(r, a),
      pendingAgreement,
    };
  }
  const branches = u.restaurantId ? await q('SELECT id, name FROM branches WHERE restaurant_id=? AND active=1 ORDER BY is_main DESC, name', [u.restaurantId]) : [];
  res.json({ user: { id: u.id, email: u.email, name: u.name, isSuperAdmin: u.isSuperAdmin, role: u.roleName, permissions: u.permissions, branchId: u.branchId }, restaurant, branches, csrfToken: u.csrfToken });
}));

authRouter.post('/change-password', requireAuth, ah(async (req, res) => {
  const b = parse(z.object({ currentPassword: z.string(), newPassword: zPassword }), req.body);
  const u = await one<any>('SELECT password_hash FROM users WHERE id=?', [req.user!.id]);
  if (!(await argon2.verify(u.password_hash, b.currentPassword))) throw badRequest('Current password is incorrect');
  await exec('UPDATE users SET password_hash=? WHERE id=?', [await hashPassword(b.newPassword), req.user!.id]);
  await exec('UPDATE auth_sessions SET revoked_at=NOW(3) WHERE user_id=? AND id<>? AND revoked_at IS NULL', [req.user!.id, req.user!.sessionId]);
  await audit({ type: 'staff', userId: req.user!.id, restaurantId: req.user!.restaurantId, ip: req.ip }, 'auth.password_changed', 'user', req.user!.id);
  res.json({ ok: true });
}));

// ---------------- Password reset ----------------
const resetLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' } } });
export const RESET_TTL_MINUTES = 60;

/** Creates a single-use reset token (only its hash is stored) and returns the link. */
export async function issuePasswordReset(userId: number, opts: { issuedBy?: number; ip?: string; ttlMinutes?: number } = {}) {
  const token = randomToken(32);
  // invalidate earlier unused links for this user
  await exec('UPDATE password_resets SET used_at=NOW(3) WHERE user_id=? AND used_at IS NULL', [userId]);
  await exec('INSERT INTO password_resets (user_id, token_hash, issued_by, expires_at, ip_address) VALUES (?,?,?,DATE_ADD(NOW(3), INTERVAL ? MINUTE),?)',
    [userId, sha256(token), opts.issuedBy ?? null, opts.ttlMinutes ?? RESET_TTL_MINUTES, opts.ip ?? null]);
  return `${config.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
}

authRouter.post('/forgot-password', resetLimiter, ah(async (req, res) => {
  const b = parse(z.object({ email: z.string().email().max(190) }), req.body);
  const user = await one<any>('SELECT id, email, name, active, restaurant_id FROM users WHERE email=?', [b.email.toLowerCase()]);
  // Same response whether or not the account exists (no account enumeration)
  if (user?.active && emailEnabled()) {
    const link = await issuePasswordReset(user.id, { ip: req.ip });
    const brand = await getBranding();
    await sendEmail(user.email, `Reset your ${brand.softwareName} password`,
      `Hello ${user.name},\n\nSomeone (hopefully you) asked to reset the password for this account.\nOpen this link within ${RESET_TTL_MINUTES} minutes to choose a new password:\n\n${link}\n\nIf you did not ask for this, ignore this email — your password stays the same.`);
    await audit({ type: 'system', ip: req.ip }, 'auth.reset_requested', 'user', user.id, {}, undefined, user.restaurant_id);
  }
  res.json({ ok: true, emailEnabled: emailEnabled() });
}));

authRouter.post('/reset-password', resetLimiter, ah(async (req, res) => {
  const b = parse(z.object({ token: z.string().min(20).max(200), password: zPassword }), req.body);
  const row = await one<any>(
    `SELECT pr.id, pr.user_id, u.restaurant_id, u.is_super_admin FROM password_resets pr JOIN users u ON u.id=pr.user_id
      WHERE pr.token_hash=? AND pr.used_at IS NULL AND pr.expires_at>NOW(3) AND u.active=1`, [sha256(b.token)]);
  if (!row) throw badRequest('This reset link is invalid or has expired. Request a new one.');
  await tx(async (db) => {
    const used = await exec('UPDATE password_resets SET used_at=NOW(3) WHERE id=? AND used_at IS NULL', [row.id], db);
    if (!used.affectedRows) throw badRequest('This reset link has already been used.');
    await exec('UPDATE users SET password_hash=?, failed_logins=0, locked_until=NULL WHERE id=?', [await hashPassword(b.password), row.user_id], db);
    await exec('UPDATE auth_sessions SET revoked_at=NOW(3) WHERE user_id=? AND revoked_at IS NULL', [row.user_id], db);
  });
  await audit({ type: 'system', ip: req.ip }, 'auth.password_reset', 'user', row.user_id, {}, undefined, row.restaurant_id);
  res.json({ ok: true });
}));

authRouter.get('/sessions', requireAuth,ah(async (req, res) => {
  res.json({ data: await q('SELECT id, ip_address, user_agent, created_at, last_seen_at, expires_at FROM auth_sessions WHERE user_id=? AND revoked_at IS NULL AND expires_at>NOW(3) ORDER BY id DESC', [req.user!.id]), current: req.user!.sessionId });
}));
authRouter.delete('/sessions/:id', requireAuth, ah(async (req, res) => {
  await exec('UPDATE auth_sessions SET revoked_at=NOW(3) WHERE id=? AND user_id=?', [Number(req.params.id), req.user!.id]);
  res.json({ ok: true });
}));

const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || 'restaurant';

export const registerSchema = z.object({
  restaurant: z.object({
    name: z.string().min(2).max(190),
    legalName: z.string().max(190).optional().nullable(),
    country: z.string().length(2).transform((s) => s.toUpperCase()),
    city: z.string().max(120).optional().nullable(),
    address: z.string().max(500).optional().nullable(),
    timezone: z.string().max(64).refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }, 'Invalid timezone'),
    currency: z.string().length(3).transform((s) => s.toUpperCase()).refine(isValidCurrency, 'Invalid ISO 4217 currency'),
    phone: z.string().max(40).optional().nullable(),
    email: z.string().email().max(190),
    planId: z.coerce.number().int().positive().optional().nullable(),
    slug: z.string().regex(/^[a-z0-9-]{3,60}$/).optional(),
  }),
  admin: z.object({ name: z.string().min(2).max(190), email: z.string().email().max(190), password: zPassword, phone: z.string().max(40).optional().nullable() }),
  agreement: z.object({
    agreementId: z.coerce.number().int().positive(),
    signerName: z.string().min(2).max(190),
    signerTitle: z.string().max(190).optional().nullable(),
    signatureDataUrl: z.string().max(1_500_000),
    accepted: z.literal(true),
  }),
});

authRouter.post('/register', registerLimiter, ah(async (req, res) => {
  const b = parse(registerSchema, req.body);
  const email = b.admin.email.toLowerCase();
  if (await one('SELECT id FROM users WHERE email=?', [email])) throw conflict('An account with this email already exists');
  const agreement = await one<any>('SELECT * FROM agreements WHERE id=? AND is_current=1', [b.agreement.agreementId]);
  if (!agreement) throw badRequest('Please accept the current platform agreement');
  if (b.restaurant.planId && !(await one('SELECT id FROM subscription_plans WHERE id=? AND active=1', [b.restaurant.planId]))) throw badRequest('Unknown plan');
  let slug = b.restaurant.slug || slugify(b.restaurant.name);
  if (['admin', 'api', 'www', 'app', 'dashboard', 'login', 'register'].includes(slug)) slug = `${slug}-r`;
  for (let i = 0; await one('SELECT id FROM restaurants WHERE slug=?', [slug]); i++) slug = `${slugify(b.restaurant.name)}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  const pw = await hashPassword(b.admin.password);

  const result = await tx(async (db) => {
    const r = await exec(
      `INSERT INTO restaurants (public_id, slug, name, legal_name, country, city, address, timezone, currency, contact_email, contact_phone, status, plan_id, settings)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',?,?)`,
      [uuid(), slug, b.restaurant.name, b.restaurant.legalName ?? null, b.restaurant.country, b.restaurant.city ?? null, b.restaurant.address ?? null, b.restaurant.timezone,
        b.restaurant.currency, b.restaurant.email, b.restaurant.phone ?? null, b.restaurant.planId ?? null, toJson(DEFAULT_RESTAURANT_SETTINGS)], db);
    const rid = r.insertId;
    await exec('INSERT INTO branches (restaurant_id, name, address, phone, is_main) VALUES (?,?,?,?,1)', [rid, 'Main branch', b.restaurant.address ?? null, b.restaurant.phone ?? null], db);
    let ownerRoleId = 0;
    for (const role of DEFAULT_ROLES) {
      const rr = await exec('INSERT INTO roles (restaurant_id, name, system_key, permissions) VALUES (?,?,?,?)', [rid, role.name, role.key, toJson(role.permissions)], db);
      if (role.key === 'owner') ownerRoleId = rr.insertId;
    }
    const u = await exec('INSERT INTO users (restaurant_id, role_id, email, password_hash, name, phone) VALUES (?,?,?,?,?,?)', [rid, ownerRoleId, email, pw, b.admin.name, b.admin.phone ?? null], db);
    await exec("INSERT INTO kitchen_stations (restaurant_id, name, sort_order) VALUES (?, 'Main kitchen', 0), (?, 'Drinks', 1)", [rid, rid], db);
    await exec("INSERT INTO qr_tokens (restaurant_id, kind, token) VALUES (?, 'online', ?)", [rid, randomToken(24)], db);
    await acceptAgreement(db, {
      restaurantId: rid, agreement, signerName: b.agreement.signerName, signerTitle: b.agreement.signerTitle ?? null, signerEmail: email,
      signatureDataUrl: b.agreement.signatureDataUrl, ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null, restaurantName: b.restaurant.name,
    });
    await audit({ type: 'staff', userId: u.insertId, restaurantId: rid, ip: req.ip }, 'restaurant.register', 'restaurant', rid, { name: b.restaurant.name, slug }, db);
    return { restaurantId: rid, userId: u.insertId };
  });
  const brand = await getBranding();
  await notify({ restaurantId: null, audience: 'platform', type: 'registration', title: `New restaurant registration: ${b.restaurant.name}`, body: `${b.restaurant.name} (${b.restaurant.country}) is awaiting approval.`, data: { restaurantId: result.restaurantId }, emailTo: await superAdminEmails() });
  const { token, csrf } = await createSession(result.userId, req.ip, req.get('user-agent'));
  setSessionCookies(res, token, csrf);
  res.status(201).json({ ok: true, slug, status: 'pending', message: `Thanks for registering with ${brand.softwareName}. Your restaurant is awaiting approval.` });
}));
