import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { exec, j, one, pool, q, tx } from '../lib/db.js';
import { ah, parse } from '../lib/http.js';
import { badRequest, conflict, notFound, suspended } from '../lib/errors.js';
import { randomPin, randomToken, sha256, turnCredentials } from '../lib/crypto.js';
import { audit } from '../lib/audit.js';
import { D } from '../lib/money.js';
import { findSessionByToken, requireActiveCustomer, requireCustomer } from '../middleware/customer.js';
import { computeAvailability, restaurantPublicAssets, suspensionInfo } from '../services/restaurantStatus.js';
import { getBranding, listPlans, restaurantSettings } from '../services/settings.js';
import { publicMenu } from '../services/menu.js';
import { createOrder, customerEditOrder } from '../services/orders.js';
import { billView, requestCash, submitManualPayment } from '../services/bills.js';
import { storeImageUpload } from '../services/storage.js';
import { emit, rooms } from '../realtime/bus.js';
import { notify } from '../services/notify.js';

export const publicRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.storage.maxUploadMb * 1024 * 1024, files: 1 } });
const customerLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false });
const writeLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false });
publicRouter.use(customerLimiter);

const zLine = z.object({
  itemId: z.coerce.number().int().positive(),
  variantId: z.coerce.number().int().positive().nullable().optional(),
  addonIds: z.array(z.coerce.number().int().positive()).max(20).optional(),
  quantity: z.coerce.number().int().min(1).max(99),
  notes: z.string().max(300).nullable().optional(),
});

/* ------------------------------ Platform ------------------------------ */

publicRouter.get('/branding', ah(async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=30');
  res.json({ data: await getBranding() });
}));
publicRouter.get('/plans', ah(async (_req, res) => { res.json({ data: await listPlans(true) }); }));
publicRouter.get('/agreement/current', ah(async (_req, res) => {
  const a = await one<any>('SELECT id, version, title, body FROM agreements WHERE is_current=1 ORDER BY id DESC LIMIT 1');
  res.json({ data: a });
}));
publicRouter.post('/demo-requests', writeLimiter, ah(async (req, res) => {
  const b = parse(z.object({ name: z.string().min(2).max(190), email: z.string().email(), phone: z.string().max(40).optional().nullable(), restaurantName: z.string().max(190).optional().nullable(), country: z.string().max(80).optional().nullable(), message: z.string().max(2000).optional().nullable() }), req.body);
  await exec('INSERT INTO demo_requests (name, email, phone, restaurant_name, country, message) VALUES (?,?,?,?,?,?)', [b.name, b.email, b.phone ?? null, b.restaurantName ?? null, b.country ?? null, b.message ?? null]);
  await notify({ restaurantId: null, audience: 'platform', type: 'demo_request', title: `Demo request from ${b.name}`, body: `${b.restaurantName || ''} ${b.email}` });
  res.status(201).json({ ok: true });
}));

/* ---------------------------- Storefront ---------------------------- */

async function restaurantBySlug(slug: string) {
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return null;
  return one<any>("SELECT * FROM restaurants WHERE slug=? AND status<>'deleted'", [slug]);
}

async function publicRestaurant(r: any, preview = false) {
  const a = await computeAvailability(r);
  const s = restaurantSettings(r);
  const assets = await restaurantPublicAssets(r);
  const theme = j<any>(preview ? r.theme_draft ?? r.theme_published : r.theme_published, null);
  const reviews = await q<any>('SELECT customer_name, rating, comment, created_at FROM feedback WHERE restaurant_id=? AND is_published=1 AND publish_permission=1 ORDER BY id DESC LIMIT 12', [r.id]);
  return {
    slug: r.slug, name: r.name, address: r.address, city: r.city, country: r.country, currency: r.currency, timezone: r.timezone, locale: r.locale,
    phone: r.contact_phone, email: r.contact_email, ...assets, theme,
    available: a.available, suspension: a.available ? null : await suspensionInfo(r, a),
    ordering: {
      onlineOpen: a.available && s.onlineOrderingOpen, delivery: s.deliveryEnabled, pickup: s.pickupEnabled, scheduled: s.scheduledOrdersEnabled,
      cashOnDelivery: s.cashOnDeliveryEnabled, deliveryCharge: s.deliveryCharge, minimumOrder: s.minimumOrderAmount, openingHours: s.openingHours,
    },
    reviews: reviews.map((x) => ({ name: x.customer_name ? x.customer_name.split(' ')[0] : 'Guest', rating: x.rating, comment: x.comment, date: x.created_at })),
  };
}

publicRouter.get('/restaurants/:slug', ah(async (req, res) => {
  const r = await restaurantBySlug(req.params.slug);
  if (!r || r.status === 'pending' || r.status === 'rejected') throw notFound('Restaurant');
  res.json({ data: await publicRestaurant(r) });
}));

publicRouter.get('/restaurants/:slug/menu', ah(async (req, res) => {
  const r = await restaurantBySlug(req.params.slug);
  if (!r || r.status === 'pending' || r.status === 'rejected') throw notFound('Restaurant');
  res.json({ data: await publicMenu(r.id, 'online') });
}));

publicRouter.get('/domain/:host', ah(async (req, res) => {
  const r = await one<any>("SELECT slug FROM restaurants WHERE custom_domain=? AND status='active'", [req.params.host.toLowerCase()]);
  res.json({ data: r ? { slug: r.slug } : null });
}));

async function assertAvailable(r: any) {
  const a = await computeAvailability(r);
  if (!a.available) throw suspended('This restaurant is not accepting orders right now', await suspensionInfo(r, a));
}

function setCustomerCookie(res: any, token: string) {
  res.cookie(config.customerSession.cookieName, token, { httpOnly: true, secure: config.session.cookieSecure, sameSite: 'lax', path: '/api/v1/public', maxAge: config.customerSession.ttlHours * 3600 * 1000 });
}

async function issueDeviceToken(db: any, sessionId: number, restaurantId: number) {
  const token = randomToken(32);
  await exec('INSERT INTO customer_session_tokens (session_id, restaurant_id, token_hash) VALUES (?,?,?)', [sessionId, restaurantId, sha256(token)], db);
  return token;
}

async function upsertCustomer(db: any, restaurantId: number, name: string, phone: string | null, recognitionOptIn: boolean, marketingOptIn: boolean) {
  if (!phone) return { customerId: null, greeting: null };
  const existing = await one<any>('SELECT * FROM customers WHERE restaurant_id=? AND phone=?', [restaurantId, phone], db);
  if (existing) {
    await exec('UPDATE customers SET name=?, recognition_opt_in=?, marketing_opt_in=?, marketing_opt_in_at=IF(?=1 AND marketing_opt_in=0, NOW(3), marketing_opt_in_at) WHERE id=?',
      [name, recognitionOptIn ? 1 : 0, marketingOptIn ? 1 : 0, marketingOptIn ? 1 : 0, existing.id], db);
    return { customerId: existing.id as number, previous: existing };
  }
  const r = await exec('INSERT INTO customers (restaurant_id, name, phone, recognition_opt_in, marketing_opt_in, marketing_opt_in_at) VALUES (?,?,?,?,?,?)',
    [restaurantId, name, phone, recognitionOptIn ? 1 : 0, marketingOptIn ? 1 : 0, marketingOptIn ? new Date() : null], db);
  return { customerId: r.insertId, previous: null };
}

function greetingFor(prev: any, name: string, r: any) {
  const s = restaurantSettings(r);
  if (!prev || !s.returningCustomerGreeting || !prev.recognition_opt_in || !prev.last_visit_at) return null;
  const d = new Intl.DateTimeFormat(r.locale || 'en', { day: 'numeric', month: 'long', timeZone: r.timezone }).format(new Date(prev.last_visit_at));
  return `Welcome back, ${name.split(' ')[0]}! We are happy to see you again. Your last visit was on ${d}.`;
}

/** Resolve a QR token (table or online). Old/revoked tokens never resolve. */
publicRouter.get('/qr/:token', ah(async (req, res) => {
  const t = await one<any>('SELECT * FROM qr_tokens WHERE token=? AND active=1 AND revoked_at IS NULL', [req.params.token]);
  if (!t) throw notFound('QR code is invalid or has been replaced. Please ask staff for help.');
  const r = await one<any>('SELECT * FROM restaurants WHERE id=?', [t.restaurant_id]);
  if (!r || r.status === 'deleted') throw notFound('Restaurant');
  const info = await publicRestaurant(r);
  if (t.kind === 'online') return res.json({ data: { kind: 'online', restaurant: info } });
  const table = await one<any>('SELECT id, name, table_number, capacity, active FROM dining_tables WHERE id=? AND restaurant_id=?', [t.table_id, r.id]);
  if (!table || !table.active) throw notFound('This table is currently disabled');
  const cookieTok = req.cookies?.[config.customerSession.cookieName];
  const mine = cookieTok ? await findSessionByToken(cookieTok) : null;
  res.json({ data: { kind: 'table', restaurant: info, table: { name: table.name, number: table.table_number }, hasSessionOnDevice: !!(mine && mine.table_id === table.id && mine.status === 'active') } });
}));

const startSchema = z.object({
  name: z.string().trim().min(1).max(190),
  phone: z.string().trim().max(40).regex(/^[+\d][\d\s-]{5,}$/, 'Invalid phone').optional().nullable().or(z.literal('')),
  recognitionOptIn: z.boolean().optional().default(false),
  marketingOptIn: z.boolean().optional().default(false),
  existingToken: z.string().max(200).optional().nullable(),
  joinPin: z.string().regex(/^\d{4}$/).optional().nullable(),
  startNew: z.boolean().optional(),
  recoverOnly: z.boolean().optional(),
});

/**
 * Start or recover a table session. Order of recovery:
 * 1) device token (localStorage header copy or HttpOnly cookie) for an active session at this table;
 * 2) join an existing table session with its 4-digit PIN or the same phone number;
 * 3) otherwise create a new session (or refuse if the table is occupied and multiple sessions are disabled).
 */
publicRouter.post('/qr/:token/session', writeLimiter, ah(async (req, res) => {
  const b = parse(startSchema, req.body);
  const phone = b.phone ? b.phone.replace(/[\s-]/g, '') : null;
  const t = await one<any>("SELECT * FROM qr_tokens WHERE token=? AND kind='table' AND active=1 AND revoked_at IS NULL", [req.params.token]);
  if (!t) throw notFound('QR code is invalid or has been replaced');
  const r = await one<any>('SELECT * FROM restaurants WHERE id=?', [t.restaurant_id]);
  await assertAvailable(r);
  const s = restaurantSettings(r);
  if (!s.dineInOpen) throw conflict('Dine-in ordering is temporarily closed. Please ask staff.');
  const table = await one<any>('SELECT * FROM dining_tables WHERE id=? AND restaurant_id=? AND active=1', [t.table_id, r.id]);
  if (!table) throw notFound('Table');

  const deviceToken = b.existingToken || req.cookies?.[config.customerSession.cookieName];
  if (deviceToken && !b.startNew) {
    const mine = await findSessionByToken(deviceToken);
    if (mine && mine.restaurant_id === r.id && mine.table_id === table.id) {
      if (mine.status === 'active' && new Date(mine.expires_at).getTime() > Date.now()) {
        setCustomerCookie(res, deviceToken);
        return res.json({ data: { token: deviceToken, recovered: true, state: 'active', pin: mine.join_pin } });
      }
      if (mine.status === 'closed' && mine.closed_at && Date.now() - new Date(mine.closed_at).getTime() < 3 * 3600_000) {
        return res.json({ data: { token: deviceToken, recovered: true, state: 'closed' } });
      }
    }
  }

  if (b.recoverOnly) return res.json({ data: { state: 'none' } });
  const result = await tx(async (db) => {
    await one('SELECT id FROM dining_tables WHERE id=? FOR UPDATE', [table.id], db); // serialise concurrent scans of one table
    const active = await q<any>("SELECT * FROM customer_sessions WHERE restaurant_id=? AND table_id=? AND status='active' AND expires_at>NOW(3) ORDER BY id", [r.id, table.id], db);
    const joinable = active.find((x) => (b.joinPin && x.join_pin === b.joinPin) || (phone && x.customer_phone === phone));
    if (joinable) {
      const token = await issueDeviceToken(db, joinable.id, r.id);
      return { token, state: 'active', joined: true, pin: joinable.join_pin, greeting: null as string | null };
    }
    if (active.length && !s.allowMultipleSessionsPerTable) {
      throw conflict('This table already has an active order. Enter the 4-digit table PIN shown on the first guest\'s phone, or ask staff for help.', { code: 'TABLE_OCCUPIED' });
    }
    const cust = await upsertCustomer(db, r.id, b.name, phone, b.recognitionOptIn, b.marketingOptIn);
    const pin = randomPin();
    const primary = randomToken(32);
    const ins = await exec(
      `INSERT INTO customer_sessions (restaurant_id, table_id, kind, order_type, customer_id, customer_name, customer_phone, token_hash, join_pin, expires_at)
       VALUES (?,?,'table','dine_in',?,?,?,?,?,DATE_ADD(NOW(3), INTERVAL ? HOUR))`,
      [r.id, table.id, cust.customerId, b.name, phone, sha256(primary), pin, config.customerSession.ttlHours], db);
    await exec('INSERT INTO customer_session_tokens (session_id, restaurant_id, token_hash) VALUES (?,?,?)', [ins.insertId, r.id, sha256(primary)], db);
    return { token: primary, state: 'active', joined: false, pin, greeting: greetingFor((cust as any).previous, b.name, r) };
  });
  setCustomerCookie(res, result.token);
  emit(rooms.staffPerm(r.id, 'orders.view'), 'table:session', { tableId: table.id, state: 'active' });
  res.status(201).json({ data: result });
}));

/** Online (takeaway/delivery) ordering session from the restaurant-wide QR or storefront URL. */
publicRouter.post('/restaurants/:slug/online-session', writeLimiter, ah(async (req, res) => {
  const r = await restaurantBySlug(req.params.slug);
  if (!r) throw notFound('Restaurant');
  await assertAvailable(r);
  const s = restaurantSettings(r);
  if (!s.onlineOrderingOpen) throw conflict('Online ordering is temporarily closed');
  const b = parse(z.object({
    name: z.string().trim().min(1).max(190), phone: startSchema.shape.phone, orderType: z.enum(['delivery', 'pickup']),
    recognitionOptIn: z.boolean().optional().default(false), marketingOptIn: z.boolean().optional().default(false),
  }), req.body);
  if (b.orderType === 'delivery' && !s.deliveryEnabled) throw badRequest('Delivery is not available');
  if (b.orderType === 'pickup' && !s.pickupEnabled) throw badRequest('Pickup is not available');
  const phone = b.phone ? b.phone.replace(/[\s-]/g, '') : null;
  const out = await tx(async (db) => {
    const cust = await upsertCustomer(db, r.id, b.name, phone, b.recognitionOptIn, b.marketingOptIn);
    const token = randomToken(32);
    const ins = await exec(
      `INSERT INTO customer_sessions (restaurant_id, table_id, kind, order_type, customer_id, customer_name, customer_phone, token_hash, join_pin, expires_at)
       VALUES (?,NULL,'online',?,?,?,?,?,?,DATE_ADD(NOW(3), INTERVAL 24 HOUR))`, [r.id, b.orderType, cust.customerId, b.name, phone, sha256(token), randomPin()], db);
    await exec('INSERT INTO customer_session_tokens (session_id, restaurant_id, token_hash) VALUES (?,?,?)', [ins.insertId, r.id, sha256(token)], db);
    return { token, greeting: greetingFor((cust as any).previous, b.name, r) };
  });
  setCustomerCookie(res, out.token);
  res.status(201).json({ data: out });
}));

/** Recover the token from the HttpOnly cookie when local storage was cleared. */
publicRouter.post('/session/resume', ah(async (req, res) => {
  const tok = req.cookies?.[config.customerSession.cookieName];
  const s = tok ? await findSessionByToken(tok) : null;
  if (!s) return res.json({ data: null });
  res.json({ data: { token: tok, status: s.status, kind: s.kind } });
}));

/* -------------------------- Customer session -------------------------- */

const cust = Router();
cust.use(requireCustomer);

cust.get('/', ah(async (req, res) => {
  const c = req.customer!; const r = req.restaurant; const s = (req as any).customerSession;
  const table = c.tableId ? await one<any>('SELECT name, table_number FROM dining_tables WHERE id=?', [c.tableId]) : null;
  const bill = c.billId ? await billView(pool, r.id, c.billId) : null;
  const settings = restaurantSettings(r);
  const methods = await q<any>(`SELECT pm.id, pm.type, pm.label, pm.bank_name, pm.account_title, pm.account_number, pm.iban, pm.instructions, pm.currency, f.public_id qr_public_id
      FROM payment_methods pm LEFT JOIN files f ON f.id=pm.qr_file_id WHERE pm.restaurant_id=? AND pm.enabled=1 ORDER BY pm.sort_order, pm.id`, [r.id]);
  const feedback = c.billId ? await one('SELECT id FROM feedback WHERE restaurant_id=? AND bill_id=?', [r.id, c.billId]) : null;
  res.json({ data: {
    session: { status: c.status, kind: c.kind, name: c.name, pin: s.join_pin, orderType: s.order_type, startedAt: s.started_at },
    restaurant: await publicRestaurant(r), table,
    settings: { editWindowMinutes: settings.editWindowMinutes, approvalRequired: settings.orderApprovalRequired, fallbackPhone: settings.fallbackPhone || r.contact_phone, loyalty: settings.loyalty.enabled },
    bill, paymentMethods: methods.map((m) => ({ ...m, qrUrl: m.qr_public_id ? `/api/v1/files/${m.qr_public_id}` : null, qr_public_id: undefined })),
    feedbackSubmitted: !!feedback,
  } });
}));

cust.get('/menu', ah(async (req, res) => {
  res.json({ data: await publicMenu(req.customer!.restaurantId, req.customer!.kind === 'online' ? 'online' : 'qr') });
}));

const orderSchema = z.object({
  lines: z.array(zLine).min(1).max(50),
  notes: z.string().max(500).optional().nullable(),
  idempotencyKey: z.string().min(8).max(80),
  deliveryAddress: z.string().max(500).optional().nullable(),
  deliveryInstructions: z.string().max(500).optional().nullable(),
  scheduledFor: z.string().datetime().optional().nullable(),
  paymentPreference: z.enum(['cash_on_delivery', 'manual']).optional(),
});

cust.post('/orders', requireActiveCustomer, writeLimiter, ah(async (req, res) => {
  const b = parse(orderSchema, req.body);
  const c = req.customer!; const r = req.restaurant; const s = (req as any).customerSession;
  const settings = restaurantSettings(r);
  if (c.kind === 'online') {
    if (!settings.onlineOrderingOpen) throw conflict('Online ordering is temporarily closed');
    if (s.order_type === 'delivery' && !b.deliveryAddress) throw badRequest('Delivery address is required');
    if (b.scheduledFor && !settings.scheduledOrdersEnabled) throw badRequest('Scheduled orders are not enabled');
  }
  const result = await tx(async (db) => {
    let billId = c.billId;
    if (billId) {
      const bill = await one<any>('SELECT status FROM bills WHERE id=?', [billId], db);
      if (bill?.status !== 'open') billId = null;
    }
    if (c.kind === 'online') billId = null; // every online order has its own bill
    const out = await createOrder(db, {
      restaurant: r, channel: c.kind === 'online' ? 'online' : 'qr', orderType: c.kind === 'online' ? s.order_type : 'dine_in',
      lines: b.lines, tableId: c.tableId, sessionId: c.sessionId, billId, customerId: c.customerId, customerName: c.name, customerPhone: s.customer_phone,
      deliveryAddress: b.deliveryAddress, deliveryInstructions: b.deliveryInstructions, scheduledFor: b.scheduledFor ? new Date(b.scheduledFor) : null,
      notes: b.notes, idempotencyKey: `c${c.sessionId}:${b.idempotencyKey}`, actor: { type: 'customer', restaurantId: r.id, ip: req.ip },
    });
    if (c.kind === 'online') {
      const subtotal = await one<any>('SELECT subtotal FROM bills WHERE id=?', [out.order.bill_id], db);
      if (D(subtotal.subtotal).lt(D(settings.minimumOrderAmount))) throw badRequest(`Minimum order amount is ${D(settings.minimumOrderAmount).toFixed(2)} ${r.currency}`);
      await exec('UPDATE customer_sessions SET bill_id=? WHERE id=?', [out.order.bill_id, c.sessionId], db);
      if (b.paymentPreference === 'cash_on_delivery' && settings.cashOnDeliveryEnabled) await requestCash(db, r.id, out.order.bill_id, c.sessionId);
    }
    return out;
  });
  res.status(result.duplicate ? 200 : 201).json({ data: { orderId: result.order.public_id, orderNo: result.order.order_no, status: result.order.status, editableUntil: result.order.editable_until, prepEstimateMinutes: result.order.prep_estimate_minutes } });
}));

async function orderForSession(req: any) {
  const o = await one<any>('SELECT * FROM orders WHERE public_id=? AND restaurant_id=? AND session_id=?', [req.params.orderId, req.customer.restaurantId, req.customer.sessionId]);
  if (!o) throw notFound('Order');
  return o;
}

cust.patch('/orders/:orderId', requireActiveCustomer, writeLimiter, ah(async (req, res) => {
  const b = parse(z.object({ lines: z.array(zLine).min(1).max(50) }), req.body);
  const o = await orderForSession(req);
  const updated = await tx((db) => customerEditOrder(db, req.restaurant, req.customer!.sessionId, o.id, b.lines));
  res.json({ data: { orderId: updated.public_id, status: updated.status } });
}));

/** After the editing window: request extra items. Creates a separately auditable addition order on the same bill. */
cust.post('/orders/:orderId/additions', requireActiveCustomer, writeLimiter, ah(async (req, res) => {
  const b = parse(z.object({ lines: z.array(zLine).min(1).max(50), idempotencyKey: z.string().min(8).max(80), notes: z.string().max(500).optional().nullable() }), req.body);
  const parent = await orderForSession(req);
  const c = req.customer!; const s = (req as any).customerSession;
  const out = await tx((db) => createOrder(db, {
    restaurant: req.restaurant, channel: parent.channel, orderType: parent.order_type, lines: b.lines, tableId: c.tableId, sessionId: c.sessionId, billId: parent.bill_id,
    customerId: c.customerId, customerName: c.name, customerPhone: s.customer_phone, notes: b.notes, parentOrderId: parent.id,
    idempotencyKey: `c${c.sessionId}:${b.idempotencyKey}`, actor: { type: 'customer', restaurantId: c.restaurantId, ip: req.ip },
  }));
  res.status(201).json({ data: { orderId: out.order.public_id, orderNo: out.order.order_no, status: out.order.status } });
}));

cust.get('/bill', ah(async (req, res) => {
  const c = req.customer!;
  if (!c.billId) return res.json({ data: null });
  res.json({ data: await billView(pool, c.restaurantId, c.billId) });
}));

cust.post('/payments', requireActiveCustomer, writeLimiter, upload.single('proof'), ah(async (req, res) => {
  const b = parse(z.object({ methodId: z.coerce.number().int().positive(), amount: z.string().regex(/^\d{1,13}(\.\d{1,4})?$/), reference: z.string().max(190).optional().nullable(), idempotencyKey: z.string().min(8).max(80) }), req.body);
  const c = req.customer!;
  if (!c.billId) throw badRequest('There is no bill to pay yet');
  if (!req.file) throw badRequest('Please attach a screenshot of your payment');
  const file = await storeImageUpload({ buffer: req.file.buffer, declaredMime: req.file.mimetype, originalName: req.file.originalname, category: 'customer-payment-proofs', restaurantId: c.restaurantId, ownerSessionId: c.sessionId });
  const id = await tx((db) => submitManualPayment(db, c.restaurantId, c.billId!, { methodId: b.methodId, amount: b.amount, proofFileId: file.id, reference: b.reference, sessionId: c.sessionId, idempotencyKey: `c${c.sessionId}:${b.idempotencyKey}` }));
  await audit({ type: 'customer', restaurantId: c.restaurantId, ip: req.ip }, 'payment.submit', 'payment', id, { billId: c.billId, amount: b.amount });
  res.status(201).json({ data: { paymentId: id, status: 'under_review' } });
}));

cust.post('/cash-request', requireActiveCustomer, writeLimiter, ah(async (req, res) => {
  const c = req.customer!;
  if (!c.billId) throw badRequest('There is no bill to pay yet');
  const id = await tx((db) => requestCash(db, c.restaurantId, c.billId!, c.sessionId));
  res.status(201).json({ data: { paymentId: id, status: 'cash_requested' } });
}));

cust.post('/support', requireActiveCustomer, writeLimiter, ah(async (req, res) => {
  const b = parse(z.object({ type: z.enum(['waiter', 'billing', 'general', 'order', 'call_back']), message: z.string().max(1000).optional().nullable() }), req.body);
  const c = req.customer!;
  const recent = await one<any>("SELECT id FROM support_requests WHERE session_id=? AND type=? AND status='open' AND created_at>DATE_SUB(NOW(3), INTERVAL 2 MINUTE)", [c.sessionId, b.type]);
  if (recent) return res.json({ data: { id: recent.id, deduplicated: true } });
  const r = await exec('INSERT INTO support_requests (restaurant_id, session_id, table_id, type, message) VALUES (?,?,?,?,?)', [c.restaurantId, c.sessionId, c.tableId, b.type, b.message ?? null]);
  const table = c.tableId ? await one<any>('SELECT name, waiter_user_id FROM dining_tables WHERE id=?', [c.tableId]) : null;
  const labels: Record<string, string> = { waiter: 'Waiter assistance', billing: 'Billing assistance', general: 'General inquiry', order: 'Order question', call_back: 'Call back request' };
  emit(rooms.staffPerm(c.restaurantId, 'support.handle'), 'support:new', { id: r.insertId, type: b.type, tableId: c.tableId, tableName: table?.name, customer: c.name, message: b.message });
  await notify({ restaurantId: c.restaurantId, type: 'support_request', permission: 'support.handle', userId: table?.waiter_user_id ?? null, title: `${labels[b.type]}${table ? ' — ' + table.name : ''}`, body: b.message || c.name, data: { requestId: r.insertId, tableId: c.tableId } });
  res.status(201).json({ data: { id: r.insertId } });
}));

cust.get('/chat', ah(async (req, res) => {
  const c = req.customer!;
  const after = Number(req.query.after) || 0;
  const rows = await q('SELECT id, sender_type, body, created_at FROM chat_messages WHERE restaurant_id=? AND session_id=? AND id>? ORDER BY id LIMIT 200', [c.restaurantId, c.sessionId, after]);
  res.json({ data: rows });
}));

cust.post('/chat', requireActiveCustomer, writeLimiter, ah(async (req, res) => {
  const b = parse(z.object({ body: z.string().trim().min(1).max(2000) }), req.body);
  const c = req.customer!;
  const r = await exec("INSERT INTO chat_messages (restaurant_id, session_id, sender_type, body) VALUES (?,?,'customer',?)", [c.restaurantId, c.sessionId, b.body]);
  const msg = { id: r.insertId, sessionId: c.sessionId, sender_type: 'customer', body: b.body, created_at: new Date(), customer: c.name, tableId: c.tableId };
  emit(rooms.staffPerm(c.restaurantId, 'support.handle'), 'chat:message', msg);
  emit(rooms.session(c.sessionId), 'chat:message', msg);
  res.status(201).json({ data: msg });
}));

cust.post('/feedback', writeLimiter, ah(async (req, res) => {
  const b = parse(z.object({
    rating: z.number().int().min(1).max(5), foodRating: z.number().int().min(1).max(5).optional().nullable(), serviceRating: z.number().int().min(1).max(5).optional().nullable(),
    comment: z.string().max(2000).optional().nullable(), suggestion: z.string().max(2000).optional().nullable(), isComplaint: z.boolean().optional(), publishPermission: z.boolean().optional(),
  }), req.body);
  const c = req.customer!;
  if (!c.billId) throw badRequest('Feedback can be given after ordering');
  const order = await one<any>("SELECT id FROM orders WHERE bill_id=? AND status IN ('served','completed') LIMIT 1", [c.billId]);
  if (!order) throw badRequest('Feedback opens once your order has been served');
  await exec(
    'INSERT INTO feedback (restaurant_id, order_id, bill_id, customer_id, customer_name, rating, food_rating, service_rating, comment, suggestion, is_complaint, publish_permission) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [c.restaurantId, order.id, c.billId, c.customerId, c.name, b.rating, b.foodRating ?? null, b.serviceRating ?? null, b.comment ?? null, b.suggestion ?? null, b.isComplaint || b.rating <= 2 ? 1 : 0, b.publishPermission ? 1 : 0]);
  if (b.isComplaint || b.rating <= 2) await notify({ restaurantId: c.restaurantId, type: 'complaint', permission: 'feedback.manage', title: `Customer complaint (${b.rating}★)`, body: b.comment || '' });
  res.status(201).json({ ok: true });
}));

/** ICE servers for WebRTC (STUN + short-lived TURN credentials when a TURN secret is configured). */
cust.get('/ice-servers', ah(async (req, res) => {
  const turn = turnCredentials(`c${req.customer!.sessionId}`);
  const iceServers: any[] = [{ urls: config.webrtc.stunUrls }];
  if (turn && config.webrtc.turnUrls.length) iceServers.push({ urls: config.webrtc.turnUrls, username: turn.username, credential: turn.credential });
  res.json({ data: { iceServers, callTimeoutSeconds: config.webrtc.callTimeoutSeconds } });
}));

publicRouter.use('/session', cust);

/* ---------------------------- Reservations ---------------------------- */

publicRouter.post('/restaurants/:slug/reservations', writeLimiter, ah(async (req, res) => {
  const r = await restaurantBySlug(req.params.slug);
  if (!r) throw notFound('Restaurant');
  await assertAvailable(r);
  const b = parse(z.object({
    customerName: z.string().min(1).max(190), phone: z.string().max(40).min(6), email: z.string().email().optional().nullable().or(z.literal('')),
    partySize: z.number().int().min(1).max(100), reservedFor: z.string().datetime(), specialRequests: z.string().max(1000).optional().nullable(),
  }), req.body);
  const when = new Date(b.reservedFor);
  if (when.getTime() < Date.now() + 15 * 60000) throw badRequest('Please choose a time at least 15 minutes from now');
  const cap = await one<any>('SELECT MAX(capacity) m FROM dining_tables WHERE restaurant_id=? AND active=1', [r.id]);
  if (cap?.m && b.partySize > Number(cap.m) * 4) throw badRequest('Party size is too large for online booking; please call the restaurant');
  const ins = await exec("INSERT INTO reservations (restaurant_id, customer_name, phone, email, party_size, reserved_for, special_requests, source) VALUES (?,?,?,?,?,?,?,'online')",
    [r.id, b.customerName, b.phone, b.email || null, b.partySize, when, b.specialRequests ?? null]);
  await notify({ restaurantId: r.id, type: 'reservation', permission: 'reservations.manage', title: `Reservation request: ${b.customerName} (${b.partySize})`, body: when.toISOString(), data: { reservationId: ins.insertId } });
  res.status(201).json({ data: { id: ins.insertId, status: 'requested' } });
}));
