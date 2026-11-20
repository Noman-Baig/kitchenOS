import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import { exec, j, one, q, toJson, tx } from '../lib/db.js';
import { ah, idParam, pageParams, parse } from '../lib/http.js';
import { badRequest, notFound } from '../lib/errors.js';
import { actorFromReq, audit } from '../lib/audit.js';
import { isValidCurrency } from '../lib/money.js';
import { signFileUrl } from '../lib/crypto.js';
import { requireSuperAdmin } from '../middleware/auth.js';
import { DEFAULT_AUTOMATIONS, DEFAULT_BRANDING, DEFAULT_SUBSCRIPTION, getSetting, setSetting, invalidateBranding, type Branding } from '../services/settings.js';
import { approveSubscriptionPayment, rejectSubscriptionPayment, setRestaurantStatus } from '../services/subscriptions.js';
import { computeAvailability } from '../services/restaurantStatus.js';
import { exportRestaurant } from '../services/tenantData.js';
import { storeImageUpload } from '../services/storage.js';
import { runBackupNow } from '../jobs/backup.js';
import { zMoney } from '../lib/crud.js';
import { registerSchema, hashPassword, issuePasswordReset } from './auth.js';
import { emailEnabled, sendEmail } from '../services/notify.js';
import { DEFAULT_ROLES } from '../lib/permissions.js';
import { DEFAULT_RESTAURANT_SETTINGS } from '../services/settings.js';
import { randomToken, uuid } from '../lib/crypto.js';

export const platformRouter = Router();
platformRouter.use(requireSuperAdmin);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.storage.maxUploadMb * 1024 * 1024, files: 1 } });

platformRouter.get('/overview', ah(async (_req, res) => {
  const [counts] = await Promise.all([
    q<any>('SELECT status, COUNT(*) c FROM restaurants GROUP BY status'),
  ]);
  const rs = await q<any>("SELECT * FROM restaurants WHERE status='active'");
  let active = 0, grace = 0, expired = 0;
  for (const r of rs) { const a = await computeAvailability(r); if (a.state === 'active') active++; else if (a.state === 'grace') grace++; else expired++; }
  const pending = await one<any>("SELECT COUNT(*) c FROM subscription_payments WHERE status='pending'");
  const mrr = await q<any>(`SELECT p.currency, SUM(p.price * 30 / p.duration_days) mrr, COUNT(*) n FROM restaurants r JOIN subscription_plans p ON p.id=r.plan_id
                             WHERE r.status='active' AND r.subscription_expires_at>NOW() GROUP BY p.currency`);
  const recentRegs = await q<any>('SELECT id, name, country, status, created_at FROM restaurants ORDER BY id DESC LIMIT 8');
  const demo = await one<any>("SELECT COUNT(*) c FROM demo_requests WHERE status='new'");
  res.json({ data: {
    byStatus: Object.fromEntries(counts.map((c) => [c.status, Number(c.c)])),
    subscriptions: { active, grace, expiredNotSwept: expired },
    pendingPayments: Number(pending.c), mrr, recentRegistrations: recentRegs, newDemoRequests: Number(demo.c),
  } });
}));

platformRouter.get('/restaurants', ah(async (req, res) => {
  const { page, pageSize, offset } = pageParams(req);
  const where: string[] = ["r.status<>'deleted'"]; const params: unknown[] = [];
  const s = String(req.query.search || '').trim();
  if (s) { where.push('(r.name LIKE ? OR r.slug LIKE ? OR r.contact_email LIKE ? OR r.city LIKE ?)'); params.push(`%${s}%`, `%${s}%`, `%${s}%`, `%${s}%`); }
  for (const f of ['status', 'country', 'currency'] as const) if (req.query[f]) { where.push(`r.${f}=?`); params.push(String(req.query[f])); }
  const sortMap: Record<string, string> = { name: 'r.name', created: 'r.created_at', expiry: 'r.subscription_expires_at', country: 'r.country' };
  const sort = sortMap[String(req.query.sort)] || 'r.created_at';
  const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
  const rows = await q<any>(`SELECT r.id, r.public_id, r.slug, r.name, r.country, r.city, r.currency, r.status, r.status_reason, r.subscription_expires_at, r.grace_days, r.deletion_scheduled_at, r.created_at, p.name plan_name,
      (SELECT COUNT(*) FROM branches b WHERE b.restaurant_id=r.id) branch_count
      FROM restaurants r LEFT JOIN subscription_plans p ON p.id=r.plan_id WHERE ${where.join(' AND ')} ORDER BY ${sort} ${dir} LIMIT ? OFFSET ?`, [...params, pageSize, offset]);
  const total = await one<any>(`SELECT COUNT(*) c FROM restaurants r WHERE ${where.join(' AND ')}`, params);
  const data = [];
  for (const r of rows) data.push({ ...r, availability: await computeAvailability(r) });
  if (req.query.format === 'csv') {
    const head = ['id', 'name', 'slug', 'country', 'city', 'currency', 'status', 'plan', 'expires', 'registered'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [head.join(','), ...data.map((r) => [r.id, r.name, r.slug, r.country, r.city, r.currency, r.availability.state, r.plan_name, r.subscription_expires_at?.toISOString?.() ?? '', r.created_at?.toISOString?.() ?? ''].map(esc).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="restaurants.csv"');
    return res.send(csv);
  }
  res.json({ data, page, pageSize, total: Number(total.c) });
}));

/** Super Admin registers a restaurant directly (already approved). The owner signs the agreement on first login. */
platformRouter.post('/restaurants', ah(async (req, res) => {
  const b = parse(registerSchema.omit({ agreement: true }), req.body);
  const email = b.admin.email.toLowerCase();
  if (await one('SELECT id FROM users WHERE email=?', [email])) throw badRequest('An account with this email already exists');
  const base = (b.restaurant.slug || b.restaurant.name).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').slice(0, 50) || 'restaurant';
  let slug = base;
  while (await one('SELECT id FROM restaurants WHERE slug=?', [slug])) slug = `${base}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  const pw = await hashPassword(b.admin.password);
  const rid = await tx(async (db) => {
    const r = await exec(`INSERT INTO restaurants (public_id, slug, name, legal_name, country, city, address, timezone, currency, contact_email, contact_phone, status, plan_id, settings, approved_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,'active',?,?,NOW(3))`, [uuid(), slug, b.restaurant.name, b.restaurant.legalName ?? null, b.restaurant.country, b.restaurant.city ?? null, b.restaurant.address ?? null, b.restaurant.timezone, b.restaurant.currency, b.restaurant.email, b.restaurant.phone ?? null, b.restaurant.planId ?? null, toJson(DEFAULT_RESTAURANT_SETTINGS)], db);
    const id = r.insertId;
    await exec('INSERT INTO branches (restaurant_id, name, address, is_main) VALUES (?,?,?,1)', [id, 'Main branch', b.restaurant.address ?? null], db);
    let owner = 0;
    for (const role of DEFAULT_ROLES) { const x = await exec('INSERT INTO roles (restaurant_id, name, system_key, permissions) VALUES (?,?,?,?)', [id, role.name, role.key, toJson(role.permissions)], db); if (role.key === 'owner') owner = x.insertId; }
    await exec('INSERT INTO users (restaurant_id, role_id, email, password_hash, name, phone) VALUES (?,?,?,?,?,?)', [id, owner, email, pw, b.admin.name, b.admin.phone ?? null], db);
    await exec("INSERT INTO kitchen_stations (restaurant_id, name, sort_order) VALUES (?, 'Main kitchen', 0), (?, 'Drinks', 1)", [id, id], db);
    await exec("INSERT INTO qr_tokens (restaurant_id, kind, token) VALUES (?, 'online', ?)", [id, randomToken(24)], db);
    return id;
  });
  await audit(actorFromReq(req), 'restaurant.platform_create', 'restaurant', rid, { name: b.restaurant.name, slug }, undefined, rid);
  res.status(201).json({ data: { id: rid, slug } });
}));

platformRouter.post('/notifications/read', ah(async (_req, res) => {
  await exec("UPDATE notifications SET read_at=NOW(3) WHERE audience='platform' AND read_at IS NULL");
  res.json({ ok: true });
}));

platformRouter.get('/restaurants/:id', ah(async (req, res) => {
  const id = idParam(req);
  const r = await one<any>('SELECT * FROM restaurants WHERE id=?', [id]);
  if (!r) throw notFound('Restaurant');
  const [branches, staff, payments, agreements, stats] = await Promise.all([
    q('SELECT * FROM branches WHERE restaurant_id=?', [id]),
    q('SELECT u.id, u.name, u.email, u.active, u.last_login_at, ro.name role FROM users u LEFT JOIN roles ro ON ro.id=u.role_id WHERE u.restaurant_id=? ORDER BY u.id', [id]),
    q<any>('SELECT sp.*, p.name plan_name, f.public_id proof_public_id FROM subscription_payments sp LEFT JOIN subscription_plans p ON p.id=sp.plan_id LEFT JOIN files f ON f.id=sp.proof_file_id WHERE sp.restaurant_id=? ORDER BY sp.id DESC', [id]),
    q<any>('SELECT aa.id, aa.signer_name, aa.signer_email, aa.signed_at, aa.content_hash, aa.platform_signature IS NOT NULL signed_by_platform, a.version, f.public_id pdf_public_id FROM agreement_acceptances aa JOIN agreements a ON a.id=aa.agreement_id LEFT JOIN files f ON f.id=aa.pdf_file_id WHERE aa.restaurant_id=? ORDER BY aa.id DESC', [id]),
    one<any>("SELECT COUNT(*) orders, COALESCE(SUM(b.total),0) revenue FROM bills b WHERE b.restaurant_id=? AND b.status='closed'", [id]),
  ]);
  res.json({ data: {
    ...r, settings: j(r.settings, {}), theme_draft: undefined, theme_published: undefined, wifi_password: undefined,
    availability: await computeAvailability(r), branches, staff, stats,
    payments: payments.map((p) => ({ ...p, proofUrl: p.proof_public_id ? signFileUrl(p.proof_public_id) : null })),
    agreements: agreements.map((a) => ({ ...a, pdfUrl: a.pdf_public_id ? signFileUrl(a.pdf_public_id) : null })),
  } });
}));

platformRouter.get('/restaurants/:id/orders', ah(async (req, res) => {
  const id = idParam(req);
  const { page, pageSize, offset } = pageParams(req);
  await audit(actorFromReq(req), 'platform.view_orders', 'restaurant', id, {}, undefined, id);
  res.json({ data: await q('SELECT o.id, o.order_no, o.channel, o.order_type, o.status, o.subtotal, o.customer_name, o.created_at FROM orders o WHERE o.restaurant_id=? ORDER BY o.id DESC LIMIT ? OFFSET ?', [id, pageSize, offset]), page, pageSize });
}));

platformRouter.post('/restaurants/:id/:action(approve|reject|suspend|reactivate)', ah(async (req, res) => {
  const b = parse(z.object({ reason: z.string().max(500).optional().nullable() }), req.body || {});
  const action = req.params.action as 'approve' | 'reject' | 'suspend' | 'reactivate';
  if ((action === 'reject' || action === 'suspend') && !b.reason) throw badRequest('A reason is required');
  await tx((db) => setRestaurantStatus(db, idParam(req), action, actorFromReq(req), b.reason));
  res.json({ ok: true });
}));

// Issue a one-time password reset link for a restaurant user (e.g. the owner lost access).
platformRouter.post('/restaurants/:id/users/:userId/reset-link', ah(async (req, res) => {
  const id = idParam(req);
  const userId = Number(req.params.userId);
  const u = await one<any>('SELECT id, email, name FROM users WHERE id=? AND restaurant_id=? AND is_super_admin=0', [userId, id]);
  if (!u) throw notFound('User');
  const link = await issuePasswordReset(u.id, { issuedBy: req.user!.id, ip: req.ip, ttlMinutes: 24 * 60 });
  let emailed = false;
  if (emailEnabled()) emailed = await sendEmail(u.email, 'Password reset link', `Hello ${u.name},\n\nThe platform administrator issued a password reset for your account. Open this link within 24 hours to choose a new password:\n\n${link}\n\nIf you did not request this, contact support.`);
  await audit(actorFromReq(req), 'platform.user_reset_link', 'user', u.id, { emailed }, undefined, id);
  res.json({ ok: true, link, emailed, expiresInHours: 24 });
}));

platformRouter.patch('/restaurants/:id', ah(async (req, res) => {
  const id = idParam(req);
  const b = parse(z.object({
    graceDays: z.number().int().min(0).max(365).nullable().optional(), planId: z.number().int().positive().nullable().optional(),
    subscriptionExpiresAt: z.string().datetime().nullable().optional(), customDomain: z.string().max(190).regex(/^[a-z0-9.-]+$/).nullable().optional(),
  }), req.body);
  const sets: string[] = []; const vals: unknown[] = [];
  if (b.graceDays !== undefined) { sets.push('grace_days=?'); vals.push(b.graceDays); }
  if (b.planId !== undefined) { sets.push('plan_id=?'); vals.push(b.planId); }
  if (b.subscriptionExpiresAt !== undefined) { sets.push('subscription_expires_at=?'); vals.push(b.subscriptionExpiresAt ? new Date(b.subscriptionExpiresAt) : null); }
  if (b.customDomain !== undefined) { sets.push('custom_domain=?'); vals.push(b.customDomain); }
  if (sets.length) await exec(`UPDATE restaurants SET ${sets.join(',')} WHERE id=?`, [...vals, id]);
  await audit(actorFromReq(req), 'restaurant.platform_update', 'restaurant', id, b, undefined, id);
  res.json({ ok: true });
}));

platformRouter.post('/restaurants/:id/deletion', ah(async (req, res) => {
  const id = idParam(req);
  const b = parse(z.object({ action: z.enum(['schedule', 'approve', 'cancel']), days: z.number().int().min(1).max(3650).optional() }), req.body);
  if (b.action === 'schedule') {
    const sub = await getSetting('subscription', DEFAULT_SUBSCRIPTION);
    await exec('UPDATE restaurants SET deletion_scheduled_at=? WHERE id=?', [new Date(Date.now() + (b.days ?? sub.dataRetentionDays) * 86400000), id]);
  } else if (b.action === 'approve') {
    const r = await one<any>('SELECT status, deletion_scheduled_at FROM restaurants WHERE id=?', [id]);
    if (!r?.deletion_scheduled_at || !['suspended', 'expired', 'rejected'].includes(r.status)) throw badRequest('Deletion can only be approved for scheduled, inactive restaurants');
    await exec('UPDATE restaurants SET deletion_approved=1 WHERE id=?', [id]);
  } else {
    await exec('UPDATE restaurants SET deletion_scheduled_at=NULL, deletion_approved=0 WHERE id=?', [id]);
  }
  await audit(actorFromReq(req), `restaurant.deletion_${b.action}`, 'restaurant', id, b, undefined, id);
  res.json({ ok: true });
}));

platformRouter.post('/restaurants/:id/export', ah(async (req, res) => {
  const id = idParam(req);
  const out = await exportRestaurant(id);
  await audit(actorFromReq(req), 'restaurant.export', 'restaurant', id, { backupId: out.backupId }, undefined, id);
  res.json({ data: { backupId: out.backupId, size: out.size, sha256: out.sha256, downloadUrl: `/api/v1/platform/backups/${out.backupId}/download` } });
}));

/* -------- subscription payments -------- */
platformRouter.get('/subscription-payments', ah(async (req, res) => {
  const { page, pageSize, offset } = pageParams(req);
  const status = req.query.status ? String(req.query.status) : null;
  const rows = await q<any>(`SELECT sp.*, r.name restaurant_name, r.slug, p.name plan_name, f.public_id proof_public_id FROM subscription_payments sp
      JOIN restaurants r ON r.id=sp.restaurant_id LEFT JOIN subscription_plans p ON p.id=sp.plan_id LEFT JOIN files f ON f.id=sp.proof_file_id
      ${status ? 'WHERE sp.status=?' : ''} ORDER BY sp.id DESC LIMIT ? OFFSET ?`, status ? [status, pageSize, offset] : [pageSize, offset]);
  res.json({ data: rows.map((p) => ({ ...p, proofUrl: p.proof_public_id ? signFileUrl(p.proof_public_id) : null, proof_public_id: undefined })), page, pageSize });
}));
platformRouter.post('/subscription-payments/:id/approve', ah(async (req, res) => {
  res.json({ data: await tx((db) => approveSubscriptionPayment(db, idParam(req), actorFromReq(req))) });
}));
platformRouter.post('/subscription-payments/:id/reject', ah(async (req, res) => {
  const b = parse(z.object({ reason: z.string().min(2).max(500) }), req.body);
  await tx((db) => rejectSubscriptionPayment(db, idParam(req), b.reason, actorFromReq(req)));
  res.json({ ok: true });
}));

/* -------- plans -------- */
const planSchema = z.object({
  name: z.string().min(2).max(120), description: z.string().max(500).nullable().optional(), price: zMoney,
  currency: z.string().length(3).transform((s) => s.toUpperCase()).refine(isValidCurrency), durationDays: z.number().int().min(1).max(3660),
  maxBranches: z.number().int().min(1).max(1000), features: z.array(z.string().max(120)).max(30).optional(), sortOrder: z.number().int().optional(), active: z.boolean().optional(),
});
platformRouter.get('/plans', ah(async (_req, res) => { res.json({ data: await q('SELECT * FROM subscription_plans ORDER BY sort_order, id') }); }));
platformRouter.post('/plans', ah(async (req, res) => {
  const b = parse(planSchema, req.body);
  const r = await exec('INSERT INTO subscription_plans (name, description, price, currency, duration_days, max_branches, features, sort_order, active) VALUES (?,?,?,?,?,?,?,?,?)',
    [b.name, b.description ?? null, b.price, b.currency, b.durationDays, b.maxBranches, toJson(b.features ?? []), b.sortOrder ?? 0, b.active === false ? 0 : 1]);
  await audit(actorFromReq(req), 'plan.create', 'subscription_plan', r.insertId, b);
  res.status(201).json({ data: { id: r.insertId } });
}));
platformRouter.patch('/plans/:id', ah(async (req, res) => {
  const b = parse(planSchema.partial(), req.body);
  const map: Record<string, string> = { name: 'name', description: 'description', price: 'price', currency: 'currency', durationDays: 'duration_days', maxBranches: 'max_branches', features: 'features', sortOrder: 'sort_order', active: 'active' };
  const sets: string[] = []; const vals: unknown[] = [];
  for (const [k, v] of Object.entries(b)) { sets.push(`${map[k]}=?`); vals.push(k === 'features' ? toJson(v) : typeof v === 'boolean' ? (v ? 1 : 0) : v); }
  if (sets.length) await exec(`UPDATE subscription_plans SET ${sets.join(',')} WHERE id=?`, [...vals, idParam(req)]);
  await audit(actorFromReq(req), 'plan.update', 'subscription_plan', idParam(req), b);
  res.json({ ok: true });
}));

/* -------- settings: branding / subscription / automations -------- */
const brandingSchema = z.object({
  softwareName: z.string().min(1).max(80), logoUrl: z.string().max(300).nullable(), faviconUrl: z.string().max(300).nullable(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/), secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  supportEmail: z.string().email(), supportPhone: z.string().max(40), businessAddress: z.string().max(300), websiteUrl: z.string().max(300),
  copyright: z.string().max(200), footerText: z.string().max(300), termsUrl: z.string().max(300), privacyUrl: z.string().max(300),
  emailSenderName: z.string().max(120), emailSenderAddress: z.string().max(190),
}).partial();
platformRouter.get('/settings', ah(async (_req, res) => {
  res.json({ data: {
    branding: await getSetting('branding', DEFAULT_BRANDING), subscription: await getSetting('subscription', DEFAULT_SUBSCRIPTION), automations: await getSetting('automations', DEFAULT_AUTOMATIONS),
    smtpConfigured: !!config.smtp.host, redisConfigured: !!config.redisUrl, turnConfigured: !!config.webrtc.turnSecret && config.webrtc.turnUrls.length > 0,
  } });
}));
platformRouter.put('/settings/branding', ah(async (req, res) => {
  const b = parse(brandingSchema, req.body);
  const cur = await getSetting<Branding>('branding', DEFAULT_BRANDING);
  await setSetting('branding', { ...cur, ...b });
  invalidateBranding();
  await audit(actorFromReq(req), 'platform.branding_update', 'platform_settings', 'branding', b);
  res.json({ ok: true });
}));
platformRouter.post('/settings/branding/:kind(logo|favicon)', upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw badRequest('File required');
  const f = await storeImageUpload({ buffer: req.file.buffer, declaredMime: req.file.mimetype, originalName: req.file.originalname, category: 'platform-branding', restaurantId: null, userId: req.user!.id });
  const cur = await getSetting<Branding>('branding', DEFAULT_BRANDING);
  await setSetting('branding', { ...cur, [req.params.kind === 'logo' ? 'logoUrl' : 'faviconUrl']: f.url });
  await audit(actorFromReq(req), `platform.${req.params.kind}_upload`, 'platform_settings', 'branding', { url: f.url });
  res.json({ data: f });
}));
platformRouter.put('/settings/subscription', ah(async (req, res) => {
  const b = parse(z.object({
    defaultGraceDays: z.number().int().min(0).max(365), reminderDaysBefore: z.array(z.number().int().min(0).max(60)).max(10), dataRetentionDays: z.number().int().min(1).max(3650),
    autoDeleteAfterRetention: z.boolean(), paymentInstructions: z.string().max(3000), trialDays: z.number().int().min(0).max(365),
    paymentMethods: z.array(z.string().max(80)).max(10),
    bankAccounts: z.array(z.object({ bankName: z.string().max(120), accountTitle: z.string().max(190), accountNumber: z.string().max(80), iban: z.string().max(80).optional(), currency: z.string().max(3).optional(), instructions: z.string().max(500).optional() })).max(10),
  }).partial(), req.body);
  const cur = await getSetting('subscription', DEFAULT_SUBSCRIPTION);
  await setSetting('subscription', { ...cur, ...b });
  await audit(actorFromReq(req), 'platform.subscription_settings', 'platform_settings', 'subscription', b);
  res.json({ ok: true });
}));
platformRouter.put('/settings/automations', ah(async (req, res) => {
  const shape = Object.fromEntries(Object.keys(DEFAULT_AUTOMATIONS).map((k) => [k, z.boolean()]));
  const b = parse(z.object(shape).partial(), req.body);
  const cur = await getSetting('automations', DEFAULT_AUTOMATIONS);
  await setSetting('automations', { ...cur, ...b });
  await audit(actorFromReq(req), 'platform.automations', 'platform_settings', 'automations', b);
  res.json({ ok: true });
}));

/* -------- agreements -------- */
platformRouter.get('/agreements', ah(async (_req, res) => { res.json({ data: await q('SELECT id, version, title, is_current, is_material, created_at, CHAR_LENGTH(body) length FROM agreements ORDER BY id DESC') }); }));
platformRouter.get('/agreements/:id', ah(async (req, res) => { res.json({ data: await one('SELECT * FROM agreements WHERE id=?', [idParam(req)]) }); }));
platformRouter.post('/agreements', ah(async (req, res) => {
  const b = parse(z.object({ version: z.string().regex(/^[\w.-]{1,20}$/), title: z.string().min(3).max(190), body: z.string().min(50).max(200000), isMaterial: z.boolean(), makeCurrent: z.boolean() }), req.body);
  const id = await tx(async (db) => {
    if (b.makeCurrent) await exec('UPDATE agreements SET is_current=0', [], db);
    const r = await exec('INSERT INTO agreements (version, title, body, is_material, is_current, created_by) VALUES (?,?,?,?,?,?)', [b.version, b.title, b.body, b.isMaterial ? 1 : 0, b.makeCurrent ? 1 : 0, req.user!.id], db);
    return r.insertId;
  });
  await audit(actorFromReq(req), 'agreement.create', 'agreement', id, { version: b.version, material: b.isMaterial, current: b.makeCurrent });
  res.status(201).json({ data: { id } });
}));
platformRouter.post('/agreements/:id/make-current', ah(async (req, res) => {
  const id = idParam(req);
  await tx(async (db) => { await exec('UPDATE agreements SET is_current=0', [], db); await exec('UPDATE agreements SET is_current=1 WHERE id=?', [id], db); });
  await audit(actorFromReq(req), 'agreement.make_current', 'agreement', id);
  res.json({ ok: true });
}));

/* -------- reports -------- */
platformRouter.get('/reports', ah(async (req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 86400000);
  const to = req.query.to ? new Date(String(req.query.to) + 'T23:59:59.999Z') : new Date();
  const filt: string[] = []; const fp: unknown[] = [];
  if (req.query.country) { filt.push('r.country=?'); fp.push(String(req.query.country)); }
  if (req.query.status) { filt.push('r.status=?'); fp.push(String(req.query.status)); }
  if (req.query.restaurantId) { filt.push('r.id=?'); fp.push(Number(req.query.restaurantId)); }
  const fs = filt.length ? ' AND ' + filt.join(' AND ') : '';
  const cur = req.query.currency ? String(req.query.currency) : null;
  const [registrations, payments, byCountry, activity, branchStats, renewals] = await Promise.all([
    q(`SELECT DATE(r.created_at) day, COUNT(*) n FROM restaurants r WHERE r.created_at BETWEEN ? AND ?${fs} GROUP BY DATE(r.created_at) ORDER BY day`, [from, to, ...fp]),
    q(`SELECT sp.status, sp.currency, COUNT(*) n, SUM(sp.amount) amount FROM subscription_payments sp JOIN restaurants r ON r.id=sp.restaurant_id WHERE sp.created_at BETWEEN ? AND ?${fs}${cur ? ' AND sp.currency=?' : ''} GROUP BY sp.status, sp.currency`, [from, to, ...fp, ...(cur ? [cur] : [])]),
    q(`SELECT r.country, r.status, COUNT(*) n FROM restaurants r WHERE r.status<>'deleted'${fs} GROUP BY r.country, r.status ORDER BY n DESC`, fp),
    q(`SELECT r.id, r.name, r.currency, COUNT(b.id) bills, COALESCE(SUM(b.total),0) gmv FROM restaurants r LEFT JOIN bills b ON b.restaurant_id=r.id AND b.status='closed' AND b.closed_at BETWEEN ? AND ? WHERE r.status<>'deleted'${fs}${cur ? ' AND r.currency=?' : ''} GROUP BY r.id ORDER BY bills DESC LIMIT 50`, [from, to, ...fp, ...(cur ? [cur] : [])]),
    q(`SELECT COUNT(*) branches, COUNT(DISTINCT b.restaurant_id) restaurants FROM branches b JOIN restaurants r ON r.id=b.restaurant_id WHERE b.active=1${fs}`, fp),
    q(`SELECT DATE(sp.reviewed_at) day, COUNT(*) n FROM subscription_payments sp JOIN restaurants r ON r.id=sp.restaurant_id WHERE sp.status='approved' AND sp.reviewed_at BETWEEN ? AND ?${fs} GROUP BY DATE(sp.reviewed_at) ORDER BY day`, [from, to, ...fp]),
  ]);
  const usage = await one<any>('SELECT (SELECT COUNT(*) FROM orders WHERE created_at BETWEEN ? AND ?) orders, (SELECT COUNT(*) FROM customer_sessions WHERE started_at BETWEEN ? AND ?) sessions, (SELECT COUNT(*) FROM users WHERE restaurant_id IS NOT NULL AND active=1) staff', [from, to, from, to]);
  res.json({ data: { from, to, registrations, payments, byCountry, activity, branchStats: branchStats[0], renewals, usage } });
}));

/* -------- operations -------- */
platformRouter.get('/audit-logs', ah(async (req, res) => {
  const { page, pageSize, offset } = pageParams(req);
  const rid = req.query.restaurantId ? Number(req.query.restaurantId) : null;
  const rows = await q<any>(`SELECT a.*, u.email user_email FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ${rid ? 'WHERE a.restaurant_id=?' : ''} ORDER BY a.id DESC LIMIT ? OFFSET ?`, rid ? [rid, pageSize, offset] : [pageSize, offset]);
  res.json({ data: rows.map((r) => ({ ...r, data: j(r.data, null) })), page, pageSize });
}));
platformRouter.get('/backups', ah(async (_req, res) => { res.json({ data: await q('SELECT * FROM backups ORDER BY id DESC LIMIT 200') }); }));
platformRouter.post('/backups/run', ah(async (req, res) => {
  const b = parse(z.object({ kind: z.enum(['database', 'storage']) }), req.body);
  const out = await runBackupNow(b.kind);
  await audit(actorFromReq(req), 'backup.manual', 'backup', out.id, b);
  res.json({ data: out });
}));
platformRouter.get('/backups/:id/download', ah(async (req, res) => {
  const b = await one<any>("SELECT * FROM backups WHERE id=? AND status='verified'", [idParam(req)]);
  if (!b) throw notFound('Backup');
  await audit(actorFromReq(req), 'backup.download', 'backup', b.id);
  res.download(b.file_path);
}));
platformRouter.get('/jobs', ah(async (_req, res) => { res.json({ data: await q('SELECT * FROM job_runs ORDER BY id DESC LIMIT 200') }); }));
platformRouter.get('/demo-requests', ah(async (_req, res) => { res.json({ data: await q('SELECT * FROM demo_requests ORDER BY id DESC LIMIT 500') }); }));
platformRouter.patch('/demo-requests/:id', ah(async (req, res) => {
  const b = parse(z.object({ status: z.enum(['new', 'contacted', 'closed']) }), req.body);
  await exec('UPDATE demo_requests SET status=? WHERE id=?', [b.status, idParam(req)]);
  res.json({ ok: true });
}));
platformRouter.get('/notifications', ah(async (_req, res) => {
  res.json({ data: await q("SELECT * FROM notifications WHERE audience='platform' ORDER BY id DESC LIMIT 100") });
}));
