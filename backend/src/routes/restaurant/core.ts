import { Router } from 'express';
import multer from 'multer';
import QRCode from 'qrcode';
import { z } from 'zod';
import { config } from '../../config.js';
import { exec, j, one, q, toJson, tx, pool } from '../../lib/db.js';
import { ah, idParam, pageParams, parse } from '../../lib/http.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { actorFromReq, audit } from '../../lib/audit.js';
import { crud, zBool, zMoney, zPosMoney } from '../../lib/crud.js';
import { PERMISSIONS, DEFAULT_ROLES, hasPermission, type Permission } from '../../lib/permissions.js';
import { requirePerm } from '../../middleware/auth.js';
import { hashPassword, zPassword } from '../auth.js';
import { DEFAULT_RESTAURANT_SETTINGS, getSubscriptionConfig, listPlans, restaurantSettings } from '../../services/settings.js';
import { storeImageUpload, CATEGORIES, type Category } from '../../services/storage.js';
import { signFileUrl } from '../../lib/crypto.js';
import { acceptAgreement } from '../../services/agreements.js';
import { exportRestaurant } from '../../services/tenantData.js';
import { emit, rooms } from '../../realtime/bus.js';
import { localRangeToUtc } from '../../services/reports.js';
import { D } from '../../lib/money.js';

export const coreRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.storage.maxUploadMb * 1024 * 1024, files: 1 } });

/* ------------------------------- Dashboard ------------------------------- */
coreRouter.get('/dashboard', requirePerm('dashboard.view'), ah(async (req, res) => {
  const r = req.restaurant; const rid = r.id;
  const range = localRangeToUtc(r.timezone, String(req.query.preset || 'today'), req.query.from as string, req.query.to as string);
  const branch = req.query.branchId ? Number(req.query.branchId) : null;
  const bsql = branch ? ' AND branch_id=?' : ''; const bp = branch ? [branch] : [];
  const [statusCounts, sales, tables, activeSessions, prep, pendingReq, pendingPay, lowStock, top, expenses, recent, hourly] = await Promise.all([
    q<any>(`SELECT status, COUNT(*) c FROM orders WHERE restaurant_id=? AND created_at>=? AND created_at<?${bsql} GROUP BY status`, [rid, range.from, range.to, ...bp]),
    one<any>(`SELECT COALESCE(SUM(total),0) total, COUNT(*) bills FROM bills WHERE restaurant_id=? AND status='closed' AND closed_at>=? AND closed_at<?${bsql}`, [rid, range.from, range.to, ...bp]),
    one<any>('SELECT COUNT(*) total FROM dining_tables WHERE restaurant_id=? AND active=1', [rid]),
    one<any>("SELECT COUNT(DISTINCT table_id) c FROM customer_sessions WHERE restaurant_id=? AND status='active' AND table_id IS NOT NULL AND expires_at>NOW(3)", [rid]),
    one<any>(`SELECT AVG(TIMESTAMPDIFF(SECOND, accepted_at, ready_at))/60 m FROM orders WHERE restaurant_id=? AND ready_at IS NOT NULL AND accepted_at IS NOT NULL AND created_at>=? AND created_at<?${bsql}`, [rid, range.from, range.to, ...bp]),
    one<any>("SELECT COUNT(*) c FROM support_requests WHERE restaurant_id=? AND status<>'resolved'", [rid]),
    one<any>("SELECT COUNT(*) c, COALESCE(SUM(amount),0) amount FROM payments WHERE restaurant_id=? AND status IN ('submitted','under_review','cash_requested')", [rid]),
    q<any>('SELECT id, name, unit, stock_qty, min_qty FROM ingredients WHERE restaurant_id=? AND active=1 AND min_qty>0 AND stock_qty<=min_qty ORDER BY (stock_qty/min_qty) LIMIT 10', [rid]),
    q<any>(`SELECT oi.menu_item_id, oi.name, SUM(oi.quantity) qty, SUM(oi.line_total) revenue FROM order_items oi JOIN orders o ON o.id=oi.order_id
             WHERE o.restaurant_id=? AND o.status NOT IN ('rejected','cancelled','draft') AND oi.status<>'cancelled' AND o.created_at>=? AND o.created_at<?${bsql.replace('branch_id', 'o.branch_id')} GROUP BY oi.menu_item_id, oi.name ORDER BY qty DESC LIMIT 8`, [rid, range.from, range.to, ...bp]),
    one<any>(`SELECT COALESCE(SUM(debit-credit),0) total FROM ledger_entries WHERE restaurant_id=? AND (account LIKE 'opex\\_%' OR account IN ('payroll','wastage','complimentary_cost','payment_fees','billing_loss')) AND entry_at>=? AND entry_at<?${bsql}`, [rid, range.from, range.to, ...bp]),
    q<any>('SELECT a.action, a.entity, a.entity_id, a.created_at, u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE a.restaurant_id=? ORDER BY a.id DESC LIMIT 10', [rid]),
    q<any>(`SELECT DATE_FORMAT(DATE_ADD(closed_at, INTERVAL ? MINUTE), '%Y-%m-%d') d, SUM(total) total, COUNT(*) n FROM bills WHERE restaurant_id=? AND status='closed' AND closed_at>=? AND closed_at<?${bsql} GROUP BY d ORDER BY d`, [range.offsetMinutes, rid, range.from, range.to, ...bp]),
  ]);
  const { profitAndLoss } = await import('../../services/ledger.js');
  const pnl = hasPermission(req.user!.permissions, 'reports.financial') || hasPermission(req.user!.permissions, 'reports.view') ? await profitAndLoss(pool, rid, range.from, range.to, branch) : null;
  const sc = Object.fromEntries(statusCounts.map((s) => [s.status, Number(s.c)]));
  res.json({ data: {
    range, currency: r.currency,
    sales: { total: sales.total, bills: Number(sales.bills) },
    orders: { total: statusCounts.reduce((s, x) => s + Number(x.c), 0), ...sc },
    tables: { total: Number(tables.total), active: Number(activeSessions.c), available: Math.max(0, Number(tables.total) - Number(activeSessions.c)) },
    avgPrepMinutes: prep?.m ? Number(prep.m).toFixed(1) : null,
    pendingRequests: Number(pendingReq.c), pendingPayments: { count: Number(pendingPay.c), amount: pendingPay.amount },
    lowStock, topItems: top, expenses: expenses.total, estimatedProfit: pnl?.netProfit ?? null, pnl, revenueSeries: hourly, recentActivity: recent,
  } });
}));

/* ------------------------------- Settings ------------------------------- */
const settingsSchema = z.object({
  name: z.string().min(2).max(190), legalName: z.string().max(190).nullable(), address: z.string().max(500).nullable(), city: z.string().max(120).nullable(),
  timezone: z.string().max(64).refine((tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } }),
  locale: z.string().max(20), contactEmail: z.string().email().nullable(), contactPhone: z.string().max(40).nullable(),
  wifiSsid: z.string().max(64).nullable(), wifiPassword: z.string().max(128).nullable(), wifiEncryption: z.enum(['WPA', 'WEP', 'nopass']),
  settings: z.object({
    orderApprovalRequired: z.boolean(), editWindowMinutes: z.number().int().min(0).max(120), allowMultipleSessionsPerTable: z.boolean(),
    stockDeductionTrigger: z.enum(['submitted', 'accepted', 'ready', 'completed']), onlineOrderingOpen: z.boolean(), dineInOpen: z.boolean(),
    deliveryEnabled: z.boolean(), pickupEnabled: z.boolean(), scheduledOrdersEnabled: z.boolean(), cashOnDeliveryEnabled: z.boolean(),
    deliveryCharge: zPosMoney, minimumOrderAmount: zPosMoney,
    openingHours: z.array(z.object({ day: z.number().int().min(0).max(6), open: z.string().regex(/^\d{2}:\d{2}$/), close: z.string().regex(/^\d{2}:\d{2}$/) })).max(21),
    returningCustomerGreeting: z.boolean(),
    loyalty: z.object({ enabled: z.boolean(), pointsPerCurrencyUnit: zPosMoney, redeemValuePerPoint: zPosMoney, minRedeemPoints: z.number().int().min(0) }),
    reservationSeatingBufferMinutes: z.number().int().min(0).max(240), callReceiverUserIds: z.array(z.number().int()).max(100), callReceiverRoleKeys: z.array(z.string().max(40)).max(20),
    fallbackPhone: z.string().max(40), kdsSound: z.boolean(), kdsDelayMinutes: z.number().int().min(1).max(240), receiptFooter: z.string().max(300), sessionIdleHours: z.number().int().min(1).max(48),
  }).partial(),
}).partial();

coreRouter.get('/settings', requirePerm('settings.manage'), ah(async (req, res) => {
  const r = req.restaurant;
  res.json({ data: {
    name: r.name, legalName: r.legal_name, address: r.address, city: r.city, country: r.country, currency: r.currency, timezone: r.timezone, locale: r.locale,
    contactEmail: r.contact_email, contactPhone: r.contact_phone, slug: r.slug, customDomain: r.custom_domain,
    wifiSsid: r.wifi_ssid, wifiPassword: r.wifi_password, wifiEncryption: r.wifi_encryption, settings: restaurantSettings(r),
    defaults: DEFAULT_RESTAURANT_SETTINGS,
  } });
}));
coreRouter.patch('/settings', requirePerm('settings.manage'), ah(async (req, res) => {
  const b = parse(settingsSchema, req.body);
  const map: Record<string, string> = { name: 'name', legalName: 'legal_name', address: 'address', city: 'city', timezone: 'timezone', locale: 'locale', contactEmail: 'contact_email', contactPhone: 'contact_phone', wifiSsid: 'wifi_ssid', wifiPassword: 'wifi_password', wifiEncryption: 'wifi_encryption' };
  const sets: string[] = []; const vals: unknown[] = [];
  for (const [k, v] of Object.entries(b)) if (map[k]) { sets.push(`${map[k]}=?`); vals.push(v); }
  if (b.settings) {
    const merged = { ...restaurantSettings(req.restaurant), ...b.settings };
    if (b.settings.loyalty) merged.loyalty = { ...restaurantSettings(req.restaurant).loyalty, ...b.settings.loyalty };
    sets.push('settings=?'); vals.push(toJson(merged));
  }
  if (sets.length) await exec(`UPDATE restaurants SET ${sets.join(',')} WHERE id=?`, [...vals, req.restaurant.id]);
  await audit(actorFromReq(req), 'restaurant.settings', 'restaurant', req.restaurant.id, { ...b, wifiPassword: b.wifiPassword ? '[set]' : undefined });
  if (b.settings && ('onlineOrderingOpen' in b.settings || 'dineInOpen' in b.settings)) emit(rooms.menu(req.restaurant.id), 'restaurant:ordering', { onlineOpen: b.settings.onlineOrderingOpen, dineInOpen: b.settings.dineInOpen });
  res.json({ ok: true });
}));

coreRouter.post('/uploads/:category', upload.single('file'), ah(async (req, res) => {
  const allowed: Record<string, Permission> = { 'restaurant-logos': 'settings.manage', 'restaurant-banners': 'website.manage', 'menu-images': 'menu.manage', 'gallery': 'website.manage', 'payment-qr': 'settings.manage' };
  const category = req.params.category as Category;
  const perm = allowed[category];
  if (!perm || !(category in CATEGORIES)) throw badRequest('Invalid upload category');
  if (!hasPermission(req.user!.permissions, perm)) throw forbidden();
  if (!req.file) throw badRequest('File is required');
  const f = await storeImageUpload({ buffer: req.file.buffer, declaredMime: req.file.mimetype, originalName: req.file.originalname, category, restaurantId: req.restaurant.id, userId: req.user!.id });
  if (category === 'restaurant-logos') await exec('UPDATE restaurants SET logo_file_id=? WHERE id=?', [f.id, req.restaurant.id]);
  if (category === 'restaurant-banners' && req.query.setAsBanner === '1') await exec('UPDATE restaurants SET banner_file_id=? WHERE id=?', [f.id, req.restaurant.id]);
  await audit(actorFromReq(req), 'file.upload', 'file', f.id, { category });
  res.status(201).json({ data: f });
}));

/* ------------------------------- Website / theme ------------------------------- */
const sectionSchema = z.object({ id: z.string().max(40), type: z.enum(['hero', 'featured', 'menu', 'about', 'gallery', 'hours', 'reviews', 'contact', 'promo', 'reservation']), enabled: z.boolean(), title: z.string().max(120).optional(), body: z.string().max(3000).optional(), images: z.array(z.string().max(300)).max(24).optional() });
const themeSchema = z.object({
  template: z.enum(['classic', 'modern', 'bistro', 'minimal']),
  colors: z.object({ primary: z.string().regex(/^#[0-9a-fA-F]{6}$/), accent: z.string().regex(/^#[0-9a-fA-F]{6}$/), background: z.string().regex(/^#[0-9a-fA-F]{6}$/), text: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  font: z.enum(['inter', 'serif', 'rounded', 'system']),
  buttonStyle: z.enum(['rounded', 'pill', 'square']),
  headerStyle: z.enum(['logo-left', 'centered', 'banner']),
  navigation: z.array(z.object({ label: z.string().max(40), target: z.string().max(200) })).max(10),
  sections: z.array(sectionSchema).max(20),
  social: z.object({ instagram: z.string().max(200), facebook: z.string().max(200), tiktok: z.string().max(200), x: z.string().max(200), whatsapp: z.string().max(40) }).partial(),
  promoBanner: z.object({ enabled: z.boolean(), text: z.string().max(200), link: z.string().max(200).optional() }).optional(),
  footerText: z.string().max(300).optional(),
  aboutText: z.string().max(3000).optional(),
});
export const DEFAULT_THEME: z.infer<typeof themeSchema> = {
  template: 'modern', colors: { primary: '#0F766E', accent: '#F59E0B', background: '#FFFFFF', text: '#111827' }, font: 'inter', buttonStyle: 'rounded', headerStyle: 'logo-left',
  navigation: [{ label: 'Menu', target: '#menu' }, { label: 'About', target: '#about' }, { label: 'Visit', target: '#contact' }],
  sections: [
    { id: 'hero', type: 'hero', enabled: true, title: 'Fresh food, made with care', body: 'Order online for pickup or delivery, or scan the QR at your table.' },
    { id: 'featured', type: 'featured', enabled: true, title: 'Featured' },
    { id: 'menu', type: 'menu', enabled: true, title: 'Menu' },
    { id: 'about', type: 'about', enabled: true, title: 'About us', body: '' },
    { id: 'gallery', type: 'gallery', enabled: false, title: 'Gallery', images: [] },
    { id: 'reviews', type: 'reviews', enabled: true, title: 'What guests say' },
    { id: 'reservation', type: 'reservation', enabled: true, title: 'Book a table' },
    { id: 'hours', type: 'hours', enabled: true, title: 'Opening hours' },
    { id: 'contact', type: 'contact', enabled: true, title: 'Find us' },
  ],
  social: {}, promoBanner: { enabled: false, text: '' }, footerText: '',
};
coreRouter.get('/website', requirePerm('website.manage'), ah(async (req, res) => {
  const r = req.restaurant;
  res.json({ data: { draft: j(r.theme_draft, null) ?? j(r.theme_published, null) ?? DEFAULT_THEME, published: j(r.theme_published, null), slug: r.slug, customDomain: r.custom_domain } });
}));
coreRouter.put('/website/draft', requirePerm('website.manage'), ah(async (req, res) => {
  const t = parse(themeSchema, req.body);
  await exec('UPDATE restaurants SET theme_draft=? WHERE id=?', [toJson(t), req.restaurant.id]);
  res.json({ ok: true });
}));
coreRouter.post('/website/publish', requirePerm('website.manage'), ah(async (req, res) => {
  const draft = j<any>(req.restaurant.theme_draft, null);
  if (!draft) throw badRequest('Nothing to publish — save a draft first');
  await exec('UPDATE restaurants SET theme_published=? WHERE id=?', [toJson(draft), req.restaurant.id]);
  await audit(actorFromReq(req), 'website.publish', 'restaurant', req.restaurant.id);
  res.json({ ok: true });
}));

/* ------------------------------- Branches ------------------------------- */
crud(coreRouter, {
  path: '/branches', table: 'branches', entity: 'branch', read: 'dashboard.view', write: 'branches.manage', orderBy: 'is_main DESC, name',
  shape: { name: z.string().min(1).max(190), address: z.string().max(500).nullable().optional(), phone: z.string().max(40).nullable().optional(), active: zBool.optional() },
  hooks: {
    beforeWrite: async (req, _d, existing) => {
      if (existing) return;
      const plan = await one<any>('SELECT p.max_branches FROM restaurants r LEFT JOIN subscription_plans p ON p.id=r.plan_id WHERE r.id=?', [req.restaurant.id]);
      const count = await one<any>('SELECT COUNT(*) c FROM branches WHERE restaurant_id=? AND active=1', [req.restaurant.id]);
      if (plan?.max_branches && Number(count.c) >= plan.max_branches) throw conflict(`Your plan allows ${plan.max_branches} branch(es). Upgrade to add more.`);
    },
    beforeDelete: async (_req, existing) => { if (existing.is_main) throw conflict('The main branch cannot be removed'); },
  },
  softDeleteCol: 'active',
});

/* ------------------------------- Staff & roles ------------------------------- */
coreRouter.get('/permissions', ah(async (_req, res) => { res.json({ data: PERMISSIONS }); }));
crud(coreRouter, {
  path: '/roles', table: 'roles', entity: 'role', read: 'staff.manage', write: 'staff.manage', orderBy: 'id', jsonCols: ['permissions'],
  shape: { name: z.string().min(2).max(80), permissions: z.array(z.enum(Object.keys(PERMISSIONS) as [Permission, ...Permission[]])).max(100) },
  hooks: {
    beforeWrite: async (req, data, existing) => {
      if (existing?.system_key === 'owner') throw forbidden('The owner role cannot be changed');
      const perms = (data.permissions as string[] | undefined) ?? [];
      for (const p of perms) if (!hasPermission(req.user!.permissions, p as Permission)) throw forbidden(`You cannot grant a permission you do not hold: ${p}`);
    },
    beforeDelete: async (_req, existing) => {
      if (existing.system_key) throw conflict('Default roles cannot be deleted');
      const used = await one<any>('SELECT COUNT(*) c FROM users WHERE role_id=?', [existing.id]);
      if (Number(used.c)) throw conflict('Role is assigned to staff');
    },
  },
});

const staffShape = {
  name: z.string().min(2).max(190), email: z.string().email().max(190).transform((s) => s.toLowerCase()), phone: z.string().max(40).nullable().optional(),
  roleId: z.coerce.number().int().positive(), branchId: z.coerce.number().int().positive().nullable().optional(),
  salary: zPosMoney.nullable().optional(), payFrequency: z.enum(['monthly', 'biweekly', 'weekly']).optional(), active: z.boolean().optional(),
};
coreRouter.get('/staff', requirePerm('staff.manage', 'waiter.use', 'orders.manage', 'payroll.manage'), ah(async (req, res) => {
  const rows = await q<any>(`SELECT u.id, u.name, u.email, u.phone, u.role_id, r.name role_name, r.system_key, u.branch_id, u.active, u.last_login_at, u.created_at ${hasPermission(req.user!.permissions, 'payroll.manage') ? ', u.salary, u.pay_frequency' : ''}
     FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.restaurant_id=? ORDER BY u.active DESC, u.name`, [req.restaurant.id]);
  res.json({ data: rows });
}));
async function assertRoleGrantable(req: any, roleId: number) {
  const role = await one<any>('SELECT * FROM roles WHERE id=? AND restaurant_id=?', [roleId, req.restaurant.id]);
  if (!role) throw badRequest('Invalid role');
  for (const p of j<string[]>(role.permissions, [])) if (!hasPermission(req.user.permissions, p as Permission)) throw forbidden('You cannot assign a role with more permissions than your own');
  return role;
}
coreRouter.post('/staff', requirePerm('staff.manage'), ah(async (req, res) => {
  const b = parse(z.object({ ...staffShape, password: zPassword }), req.body);
  await assertRoleGrantable(req, b.roleId);
  if (b.branchId && !(await one('SELECT id FROM branches WHERE id=? AND restaurant_id=?', [b.branchId, req.restaurant.id]))) throw badRequest('Invalid branch');
  if (await one('SELECT id FROM users WHERE email=?', [b.email])) throw conflict('Email already in use');
  const r = await exec('INSERT INTO users (restaurant_id, branch_id, role_id, email, password_hash, name, phone, salary, pay_frequency) VALUES (?,?,?,?,?,?,?,?,?)',
    [req.restaurant.id, b.branchId ?? null, b.roleId, b.email, await hashPassword(b.password), b.name, b.phone ?? null, b.salary ?? null, b.payFrequency ?? 'monthly']);
  await audit(actorFromReq(req), 'staff.create', 'user', r.insertId, { email: b.email, roleId: b.roleId });
  res.status(201).json({ data: { id: r.insertId } });
}));
coreRouter.patch('/staff/:id', requirePerm('staff.manage'), ah(async (req, res) => {
  const id = idParam(req);
  const u = await one<any>('SELECT u.*, r.system_key FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.id=? AND u.restaurant_id=?', [id, req.restaurant.id]);
  if (!u) throw notFound('Staff member');
  const b = parse(z.object({ ...staffShape, password: zPassword }).partial(), req.body);
  if (u.system_key === 'owner' && req.user!.id !== u.id && !hasPermission(req.user!.permissions, 'subscription.manage')) throw forbidden('Only the owner can modify the owner account');
  if (id === req.user!.id && b.active === false) throw conflict('You cannot disable your own account');
  if (b.roleId) await assertRoleGrantable(req, b.roleId);
  const map: Record<string, string> = { name: 'name', email: 'email', phone: 'phone', roleId: 'role_id', branchId: 'branch_id', salary: 'salary', payFrequency: 'pay_frequency', active: 'active' };
  const sets: string[] = []; const vals: unknown[] = [];
  for (const [k, v] of Object.entries(b)) if (map[k]) { sets.push(`${map[k]}=?`); vals.push(typeof v === 'boolean' ? (v ? 1 : 0) : v); }
  if (b.password) { sets.push('password_hash=?'); vals.push(await hashPassword(b.password)); }
  if (sets.length) await exec(`UPDATE users SET ${sets.join(',')} WHERE id=? AND restaurant_id=?`, [...vals, id, req.restaurant.id]);
  if (b.active === false || b.password || b.roleId) await exec('UPDATE auth_sessions SET revoked_at=NOW(3) WHERE user_id=? AND revoked_at IS NULL', [id]);
  await audit(actorFromReq(req), 'staff.update', 'user', id, { ...b, password: b.password ? '[changed]' : undefined });
  res.json({ ok: true });
}));

/* ------------------------------- Taxes / payment methods / printers ------------------------------- */
crud(coreRouter, {
  path: '/taxes', table: 'taxes', entity: 'tax', read: 'billing.view', write: 'taxes.manage', orderBy: 'sort_order, id', jsonCols: ['applies_to', 'order_types'],
  shape: {
    name: z.string().min(1).max(80), calc_type: z.enum(['percent', 'fixed']), rate: zPosMoney, inclusive: zBool.optional(),
    applies_to: z.object({ itemIds: z.array(z.number().int()).max(500).optional(), categoryIds: z.array(z.number().int()).max(200).optional() }).nullable().optional(),
    order_types: z.array(z.enum(['dine_in', 'takeaway', 'delivery', 'pickup'])).nullable().optional(),
    is_optional: zBool.optional(), default_selected: zBool.optional(), is_liability: zBool.optional(), enabled: zBool.optional(),
    effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), sort_order: z.number().int().optional(),
  },
  hooks: { beforeWrite: async (_req, d) => { if (d.calc_type === 'percent' && d.rate && D(d.rate as string).gt(100)) throw badRequest('Percentage cannot exceed 100'); } },
});
crud(coreRouter, {
  path: '/payment-methods', table: 'payment_methods', entity: 'payment_method', read: 'billing.view', write: 'settings.manage', orderBy: 'sort_order, id',
  shape: {
    type: z.enum(['bank', 'wallet', 'card', 'cash', 'other']), label: z.string().min(1).max(120), bank_name: z.string().max(120).nullable().optional(), account_title: z.string().max(190).nullable().optional(),
    account_number: z.string().max(80).nullable().optional(), iban: z.string().max(80).nullable().optional(), instructions: z.string().max(1000).nullable().optional(),
    qr_file_id: z.number().int().positive().nullable().optional(), currency: z.string().length(3).nullable().optional(), fee_percent: zPosMoney.optional(), enabled: zBool.optional(), sort_order: z.number().int().optional(),
  },
  hooks: { beforeWrite: async (req, d) => { if (d.qr_file_id && !(await one("SELECT id FROM files WHERE id=? AND restaurant_id=? AND category='payment-qr'", [d.qr_file_id, req.restaurant.id]))) throw badRequest('Invalid QR image'); } },
});
crud(coreRouter, {
  path: '/printers', table: 'printers', entity: 'printer', read: 'pos.use', write: 'settings.manage', orderBy: 'is_default DESC, name', refs: { branch_id: 'branches', station_id: 'kitchen_stations' },
  shape: {
    name: z.string().min(1).max(120), connection: z.enum(['browser', 'usb', 'bluetooth', 'network']), address: z.string().max(190).nullable().optional(),
    paper_width_mm: z.union([z.literal(58), z.literal(80)]), chars_per_line: z.number().int().min(24).max(64), encoding: z.enum(['cp437', 'cp858', 'utf8']),
    purpose: z.enum(['receipt', 'kitchen', 'both']), station_id: z.number().int().positive().nullable().optional(), branch_id: z.number().int().positive().nullable().optional(), is_default: zBool.optional(),
  },
});
coreRouter.post('/printers/:id/status', requirePerm('pos.use'), ah(async (req, res) => {
  const b = parse(z.object({ status: z.enum(['ok', 'failed', 'disconnected']) }), req.body);
  await exec('UPDATE printers SET last_status=?, last_test_at=NOW(3) WHERE id=? AND restaurant_id=?', [b.status, idParam(req), req.restaurant.id]);
  res.json({ ok: true });
}));

/* ------------------------------- Wi-Fi & online QR ------------------------------- */
const wifiEscape = (s: string) => s.replace(/([\\;,:"])/g, '\\$1');
coreRouter.get('/qr/wifi', requirePerm('tables.manage'), ah(async (req, res) => {
  const r = req.restaurant;
  if (!r.wifi_ssid) throw badRequest('Configure Wi-Fi SSID in settings first');
  const payload = `WIFI:T:${r.wifi_encryption};S:${wifiEscape(r.wifi_ssid)};P:${wifiEscape(r.wifi_password || '')};;`;
  res.type(req.query.format === 'png' ? 'image/png' : 'image/svg+xml');
  if (req.query.format === 'png') return res.send(await QRCode.toBuffer(payload, { width: 1024, margin: 2 }));
  res.send(await QRCode.toString(payload, { type: 'svg', margin: 2 }));
}));
coreRouter.get('/qr/online', requirePerm('tables.manage'), ah(async (req, res) => {
  const t = await one<any>("SELECT token FROM qr_tokens WHERE restaurant_id=? AND kind='online' AND active=1 ORDER BY id DESC LIMIT 1", [req.restaurant.id]);
  if (!t) throw notFound('Online QR');
  const url = `${config.appUrl}/q/${t.token}`;
  if (req.query.format === 'json') return res.json({ data: { url } });
  res.type(req.query.format === 'png' ? 'image/png' : 'image/svg+xml');
  if (req.query.format === 'png') return res.send(await QRCode.toBuffer(url, { width: 1024, margin: 2, errorCorrectionLevel: 'M' }));
  res.send(await QRCode.toString(url, { type: 'svg', margin: 2 }));
}));

/* ------------------------------- Subscription & agreements ------------------------------- */
coreRouter.get('/subscription', ah(async (req, res) => {
  const r = req.restaurant;
  const sub = await getSubscriptionConfig();
  const payments = await q('SELECT sp.id, sp.amount, sp.currency, sp.method, sp.reference, sp.status, sp.rejection_reason, sp.period_start, sp.period_end, sp.created_at, p.name plan_name FROM subscription_payments sp LEFT JOIN subscription_plans p ON p.id=sp.plan_id WHERE sp.restaurant_id=? ORDER BY sp.id DESC', [r.id]);
  res.json({ data: {
    availability: r.availability, planId: r.plan_id, plans: await listPlans(true), payments,
    instructions: sub.paymentInstructions, bankAccounts: sub.bankAccounts, paymentMethods: sub.paymentMethods, graceDays: r.grace_days ?? sub.defaultGraceDays,
  } });
}));
coreRouter.post('/subscription/payments', requirePerm('subscription.manage'), upload.single('proof'), ah(async (req, res) => {
  const b = parse(z.object({ planId: z.coerce.number().int().positive(), method: z.string().min(2).max(80), reference: z.string().max(190).optional().nullable() }), req.body);
  const plan = await one<any>('SELECT * FROM subscription_plans WHERE id=? AND active=1', [b.planId]);
  if (!plan) throw badRequest('Unknown plan');
  if (!req.file) throw badRequest('Payment screenshot is required');
  const pending = await one("SELECT id FROM subscription_payments WHERE restaurant_id=? AND status='pending'", [req.restaurant.id]);
  if (pending) throw conflict('You already have a payment awaiting review');
  const f = await storeImageUpload({ buffer: req.file.buffer, declaredMime: req.file.mimetype, originalName: req.file.originalname, category: 'subscription-payment-proofs', restaurantId: req.restaurant.id, userId: req.user!.id });
  const r = await exec('INSERT INTO subscription_payments (restaurant_id, plan_id, amount, currency, method, reference, proof_file_id) VALUES (?,?,?,?,?,?,?)', [req.restaurant.id, plan.id, plan.price, plan.currency, b.method, b.reference ?? null, f.id]);
  await audit(actorFromReq(req), 'subscription.payment_submitted', 'subscription_payment', r.insertId, { planId: plan.id });
  const { notify, superAdminEmails } = await import('../../services/notify.js');
  await notify({ restaurantId: null, audience: 'platform', type: 'subscription_payment', title: `Subscription payment submitted: ${req.restaurant.name}`, body: `${plan.name} — ${plan.price} ${plan.currency}`, emailTo: await superAdminEmails() });
  res.status(201).json({ data: { id: r.insertId } });
}));
coreRouter.get('/agreements', ah(async (req, res) => {
  const rows = await q<any>('SELECT aa.id, aa.signer_name, aa.signer_email, aa.signed_at, aa.content_hash, a.version, a.title, f.public_id pdf FROM agreement_acceptances aa JOIN agreements a ON a.id=aa.agreement_id LEFT JOIN files f ON f.id=aa.pdf_file_id WHERE aa.restaurant_id=? ORDER BY aa.id DESC', [req.restaurant.id]);
  const current = await one<any>('SELECT id, version, title, body, is_material FROM agreements WHERE is_current=1');
  res.json({ data: { history: rows.map((r) => ({ ...r, pdfUrl: r.pdf ? signFileUrl(r.pdf) : null, pdf: undefined })), current, needsAcceptance: !!current && !rows.some((r) => r.version === current.version) } });
}));
coreRouter.post('/agreements/accept', requirePerm('subscription.manage'), ah(async (req, res) => {
  const b = parse(z.object({ agreementId: z.number().int().positive(), signerName: z.string().min(2).max(190), signerTitle: z.string().max(190).nullable().optional(), signatureDataUrl: z.string().max(1_500_000), accepted: z.literal(true) }), req.body);
  const a = await one<any>('SELECT * FROM agreements WHERE id=? AND is_current=1', [b.agreementId]);
  if (!a) throw badRequest('Agreement is not current');
  const out = await tx((db) => acceptAgreement(db, { restaurantId: req.restaurant.id, agreement: a, signerName: b.signerName, signerTitle: b.signerTitle ?? null, signerEmail: req.user!.email, signatureDataUrl: b.signatureDataUrl, ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null, restaurantName: req.restaurant.name }));
  await audit(actorFromReq(req), 'agreement.accept', 'agreement', a.id, { version: a.version, hash: out.hash });
  res.status(201).json({ data: out });
}));

/* ------------------------------- Notifications & audit ------------------------------- */
coreRouter.get('/notifications', ah(async (req, res) => {
  const rows = await q<any>('SELECT * FROM notifications WHERE restaurant_id=? AND (user_id IS NULL OR user_id=?) ORDER BY id DESC LIMIT 100', [req.restaurant.id, req.user!.id]);
  res.json({ data: rows.map((r) => ({ ...r, data: j(r.data, null) })), unread: rows.filter((r) => !r.read_at).length });
}));
coreRouter.post('/notifications/read', ah(async (req, res) => {
  const b = parse(z.object({ ids: z.array(z.number().int()).max(500).optional() }), req.body || {});
  if (b.ids?.length) await exec('UPDATE notifications SET read_at=NOW(3) WHERE restaurant_id=? AND id IN (?) AND read_at IS NULL', [req.restaurant.id, b.ids]);
  else await exec('UPDATE notifications SET read_at=NOW(3) WHERE restaurant_id=? AND (user_id IS NULL OR user_id=?) AND read_at IS NULL', [req.restaurant.id, req.user!.id]);
  res.json({ ok: true });
}));
coreRouter.get('/audit-logs', requirePerm('audit.view'), ah(async (req, res) => {
  const { page, pageSize, offset } = pageParams(req);
  const rows = await q<any>('SELECT a.*, u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE a.restaurant_id=? ORDER BY a.id DESC LIMIT ? OFFSET ?', [req.restaurant.id, pageSize, offset]);
  res.json({ data: rows.map((r) => ({ ...r, data: j(r.data, null) })), page, pageSize });
}));

coreRouter.post('/export', requirePerm('subscription.manage'), ah(async (req, res) => {
  const out = await exportRestaurant(req.restaurant.id);
  await audit(actorFromReq(req), 'restaurant.self_export', 'restaurant', req.restaurant.id, { backupId: out.backupId });
  res.json({ data: { size: out.size, sha256: out.sha256, downloadUrl: `/api/v1/r/export/${out.backupId}` } });
}));
coreRouter.get('/export/:id', requirePerm('subscription.manage'), ah(async (req, res) => {
  const b = await one<any>("SELECT * FROM backups WHERE id=? AND restaurant_id=? AND kind='restaurant_export' AND status='verified'", [idParam(req), req.restaurant.id]);
  if (!b) throw notFound('Export');
  res.download(b.file_path, `restaurant-export-${req.restaurant.slug}.json.gz`);
}));

coreRouter.get('/defaults/roles', ah(async (_req, res) => { res.json({ data: DEFAULT_ROLES }); }));
