/**
 * End-to-end scenario against a real MySQL/MariaDB database:
 * Super Admin approves a restaurant → restaurant configures menu/taxes/stock/tables → customer scans QR → order →
 * kitchen → waiter → additional items → bill → payment proof → approval → inventory & ledger → re-scan state.
 * Then POS and online ordering, plus security (tenant isolation, CSRF, privilege escalation, QR revocation, suspension).
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { exec, one, pool, q } from '../../src/lib/db.js';
import { hashPassword } from '../../src/routes/auth.js';
import { ensureStorageDirs } from '../../src/services/storage.js';
import { D } from '../../src/lib/money.js';
import { Client, Customer, key, pngBuffer, signatureDataUrl } from './helpers.js';

let app: Express;
const SA = { email: 'sa@test.local', password: 'SuperAdmin123' };
const OWNER = { email: 'owner@resto-a.test', password: 'OwnerPass123' };
const OWNER_B = { email: 'owner@resto-b.test', password: 'OwnerPass456' };
let admin: Client, owner: Client, ownerB: Client;
let restaurantId = 0, restaurantBId = 0;
const ids: Record<string, number> = {};
let tableToken = '';

async function register(o: { email: string; password: string }, name: string, currency = 'USD') {
  const agreement = (await request(app).get('/api/v1/public/agreement/current')).body.data;
  const c = new Client(app);
  const r = await c.agent.post('/api/v1/auth/register').send({
    restaurant: { name, country: 'US', city: 'Austin', timezone: 'America/Chicago', currency, email: o.email, planId: 1 },
    admin: { name: `${name} Owner`, email: o.email, password: o.password },
    agreement: { agreementId: agreement.id, signerName: `${name} Owner`, signerTitle: 'Director', signatureDataUrl: await signatureDataUrl(), accepted: true },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return (await one<any>('SELECT restaurant_id FROM users WHERE email=?', [o.email])).restaurant_id as number;
}

beforeAll(async () => {
  await ensureStorageDirs();
  app = createApp();
  await exec('INSERT INTO users (is_super_admin, email, password_hash, name) VALUES (1,?,?,?)', [SA.email, await hashPassword(SA.password), 'SA']);
  admin = new Client(app); await admin.login(SA.email, SA.password);
});
afterAll(async () => { await pool.end(); });

describe('1. onboarding & super admin', () => {
  it('registers restaurants with a signed agreement and blocks access until approval', async () => {
    restaurantId = await register(OWNER, 'Resto A');
    restaurantBId = await register(OWNER_B, 'Resto B');
    const acc = await one<any>('SELECT * FROM agreement_acceptances WHERE restaurant_id=?', [restaurantId]);
    expect(acc.content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(acc.pdf_file_id).toBeTruthy();
    owner = new Client(app); await owner.login(OWNER.email, OWNER.password);
    const blocked = await owner.get('/api/v1/r/dashboard');
    expect(blocked.status).toBe(402);
    expect(blocked.body.error.details.supportEmail).toBeTruthy();
  });

  it('super admin approves registration and approves a subscription payment proof', async () => {
    expect((await admin.post(`/api/v1/platform/restaurants/${restaurantId}/approve`, {})).status).toBe(200);
    expect((await admin.post(`/api/v1/platform/restaurants/${restaurantBId}/approve`, {})).status).toBe(200);
    // restaurant submits payment proof for its subscription (allowed while unpaid)
    const up = await owner.upload('/api/v1/r/subscription/payments').field('planId', '1').field('method', 'Bank transfer').field('reference', 'TX-1').attach('proof', await pngBuffer(), 'proof.png');
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const pending = (await admin.get('/api/v1/platform/subscription-payments?status=pending')).body.data;
    const mine = pending.find((p: any) => p.restaurant_id === restaurantId);
    expect(mine.proofUrl).toContain('sig=');
    expect((await admin.post(`/api/v1/platform/subscription-payments/${mine.id}/approve`, {})).status).toBe(200);
    await exec('UPDATE restaurants SET subscription_expires_at=DATE_ADD(NOW(), INTERVAL 30 DAY) WHERE id=?', [restaurantBId]);
    const dash = await owner.get('/api/v1/r/dashboard');
    expect(dash.status).toBe(200);
    ownerB = new Client(app); await ownerB.login(OWNER_B.email, OWNER_B.password);
  });

  it('branding changes propagate to the public branding endpoint', async () => {
    expect((await admin.put('/api/v1/platform/settings/branding', { softwareName: 'umemaai_undated_version', supportEmail: 'help@test.local' })).status).toBe(200);
    const b = await request(app).get('/api/v1/public/branding');
    expect(b.body.data.softwareName).toBe('umemaai_undated_version');
    expect(b.body.data.supportEmail).toBe('help@test.local');
  });
});

describe('2. restaurant configuration', () => {
  it('configures settings, taxes, menu, recipe, stock and a table', async () => {
    expect((await owner.patch('/api/v1/r/settings', { settings: { orderApprovalRequired: true, editWindowMinutes: 5, stockDeductionTrigger: 'accepted' } })).status).toBe(200);
    const vat = await owner.post('/api/v1/r/taxes', { name: 'GST', calc_type: 'percent', rate: '10', is_liability: true });
    expect(vat.status, JSON.stringify(vat.body)).toBe(201);
    await owner.post('/api/v1/r/taxes', { name: 'Service', calc_type: 'percent', rate: '5', is_optional: true, default_selected: true, is_liability: false });
    const station = (await owner.get('/api/v1/r/stations')).body.data[0];
    const cat = await owner.post('/api/v1/r/categories', { name: 'Pizza', station_id: station.id, prep_minutes: 15 });
    ids.category = cat.body.data.id;
    const img = await owner.upload('/api/v1/r/uploads/menu-images').attach('file', await pngBuffer(600, 400), 'pizza.png');
    expect(img.status).toBe(201);
    const item = await owner.post('/api/v1/r/items', { category_id: ids.category, name: 'Margherita', price: '20.00', image_file_id: img.body.data.id });
    expect(item.status, JSON.stringify(item.body)).toBe(201);
    ids.item = item.body.data.id;
    ids.item2 = (await owner.post('/api/v1/r/items', { category_id: ids.category, name: 'Garlic bread', price: '8.00' })).body.data.id;
    const cheese = await owner.post('/api/v1/r/ingredients', { name: 'Cheese', unit: 'g', min_qty: '1000' });
    ids.cheese = cheese.body.data.id;
    const adj = await owner.post('/api/v1/r/inventory/adjust', { ingredientId: ids.cheese, mode: 'opening', quantity: '1500', unitCost: '0.02', reason: 'Opening stock' });
    expect(adj.status, JSON.stringify(adj.body)).toBe(200);
    const recipe = await owner.put(`/api/v1/r/recipes/${ids.item}`, { yieldQty: '1', wastagePct: '0', lines: [{ ingredientId: ids.cheese, quantity: '150' }] });
    expect(recipe.body.data.unitCost).toBe('3.0000');
    const t = await owner.post('/api/v1/r/tables', { name: 'Table 1', table_number: '1', capacity: 4 });
    ids.table = t.body.data.id;
    const qr = await owner.get(`/api/v1/r/tables/${ids.table}/qr?format=json`);
    tableToken = qr.body.data.url.split('/t/')[1];
    expect(tableToken.length).toBeGreaterThan(20);
    const svg = await owner.get(`/api/v1/r/tables/${ids.table}/qr`);
    expect(svg.headers['content-type']).toContain('image/svg+xml');
    expect((await owner.post('/api/v1/r/payment-methods', { type: 'bank', label: 'Bank transfer', bank_name: 'Test Bank', account_number: '123', iban: 'XX00' })).status).toBe(201);
    ids.method = (await owner.get('/api/v1/r/payment-methods')).body.data[0].id;
    const theme = await owner.get('/api/v1/r/website');
    expect((await owner.put('/api/v1/r/website/draft', theme.body.data.draft)).status).toBe(200);
    expect((await owner.post('/api/v1/r/website/publish', {})).status).toBe(200);
  });
});

const guest = () => new Customer(app);
let cust: Customer;
let orderPublicId = '';

describe('3. customer QR ordering lifecycle', () => {
  it('scans, starts a session and sees the live menu', async () => {
    const scan = await request(app).get(`/api/v1/public/qr/${tableToken}`);
    expect(scan.status).toBe(200);
    expect(scan.body.data.table.name).toBe('Table 1');
    cust = guest();
    const s = await request(app).post(`/api/v1/public/qr/${tableToken}/session`).send({ name: 'Nouman', phone: '+15551234567', recognitionOptIn: true });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    cust.token = s.body.data.token;
    const menu = await cust.get('/api/v1/public/session/menu');
    expect(menu.body.data.categories[0].items.map((i: any) => i.name)).toContain('Margherita');
  });

  it('a second phone cannot join the occupied table without the PIN', async () => {
    const r = await request(app).post(`/api/v1/public/qr/${tableToken}/session`).send({ name: 'Stranger' });
    expect(r.status).toBe(409);
    expect(r.body.error.details.code).toBe('TABLE_OCCUPIED');
    const pin = (await cust.get('/api/v1/public/session')).body.data.session.pin;
    const join = await request(app).post(`/api/v1/public/qr/${tableToken}/session`).send({ name: 'Friend', joinPin: pin });
    expect(join.status).toBe(201);
    expect(join.body.data.joined).toBe(true);
  });

  it('places an order that needs approval; server prices it (client prices ignored)', async () => {
    const r = await cust.post('/api/v1/public/session/orders', { idempotencyKey: key(), lines: [{ itemId: ids.item, quantity: 2, price: '0.01' }] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data.status).toBe('pending_approval');
    orderPublicId = r.body.data.orderId;
    const bill = (await cust.get('/api/v1/public/session/bill')).body.data;
    expect(bill.subtotal).toBe('40.0000');
    expect(bill.taxes.map((t: any) => t.name).sort()).toEqual(['GST', 'Service']);
    expect(bill.total).toBe('46.0000');
  });

  it('idempotent submit does not duplicate', async () => {
    const k = key();
    const a = await cust.post('/api/v1/public/session/orders', { idempotencyKey: k, lines: [{ itemId: ids.item2, quantity: 1 }] });
    const b = await cust.post('/api/v1/public/session/orders', { idempotencyKey: k, lines: [{ itemId: ids.item2, quantity: 1 }] });
    expect(a.body.data.orderId).toBe(b.body.data.orderId);
    expect(b.status).toBe(200);
    const o = await one<any>('SELECT id FROM orders WHERE public_id=?', [a.body.data.orderId]);
    await owner.post(`/api/v1/r/orders/${o.id}/status`, { status: 'rejected', reason: 'Out of bread' });
  });

  it('customer can edit inside the window', async () => {
    const r = await cust.patch(`/api/v1/public/session/orders/${orderPublicId}`, { lines: [{ itemId: ids.item, quantity: 3 }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const bill = (await cust.get('/api/v1/public/session/bill')).body.data;
    expect(bill.subtotal).toBe('60.0000');
  });

  it('unavailable items are rejected and availability updates live', async () => {
    await owner.post(`/api/v1/r/items/${ids.item2}/availability`, { available: false });
    const r = await cust.post('/api/v1/public/session/orders', { idempotencyKey: key(), lines: [{ itemId: ids.item2, quantity: 1 }] });
    expect(r.status).toBe(409);
    expect(r.body.error.details.unavailable[0].name).toBe('Garlic bread');
    await owner.post(`/api/v1/r/items/${ids.item2}/availability`, { available: true });
  });

  it('restaurant accepts → kitchen ticket created & stock deducted; kitchen → ready; waiter → served', async () => {
    const order = await one<any>('SELECT * FROM orders WHERE public_id=?', [orderPublicId]);
    ids.order = order.id;
    expect((await owner.post(`/api/v1/r/orders/${order.id}/status`, { status: 'accepted' })).status).toBe(200);
    const cheese = await one<any>('SELECT stock_qty FROM ingredients WHERE id=?', [ids.cheese]);
    expect(D(cheese.stock_qty).toFixed(0)).toBe('1050'); // 1500 - 3*150
    const tickets = (await owner.get('/api/v1/r/kitchen/tickets')).body.data;
    const t = tickets.find((x: any) => x.order_id === order.id);
    expect(t.items[0].quantity).toBe(3);
    expect((await owner.post(`/api/v1/r/kitchen/tickets/${t.id}/status`, { status: 'preparing' })).body.data.orderStatus).toBe('preparing');
    expect((await owner.post(`/api/v1/r/kitchen/tickets/${t.id}/status`, { status: 'ready' })).body.data.orderStatus).toBe('ready');
    expect((await owner.post(`/api/v1/r/orders/${order.id}/status`, { status: 'served' })).body.data.status).toBe('served');
    // low stock alert crossed (1050 > 1000 so not yet) — order more to cross the threshold later
  });

  it('after the edit window the original order is locked but additions are allowed and auditable', async () => {
    await exec('UPDATE orders SET editable_until=DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id=?', [ids.order]);
    const edit = await cust.patch(`/api/v1/public/session/orders/${orderPublicId}`, { lines: [{ itemId: ids.item, quantity: 1 }] });
    expect(edit.status).toBe(409);
    const add = await cust.post(`/api/v1/public/session/orders/${orderPublicId}/additions`, { idempotencyKey: key(), lines: [{ itemId: ids.item, quantity: 1 }] });
    expect(add.status, JSON.stringify(add.body)).toBe(201);
    const child = await one<any>('SELECT * FROM orders WHERE public_id=?', [add.body.data.orderId]);
    expect(child.parent_order_id).toBe(ids.order);
    expect(child.is_addition).toBe(1);
    await owner.post(`/api/v1/r/orders/${child.id}/status`, { status: 'accepted' });
    const low = await one<any>("SELECT COUNT(*) c FROM notifications WHERE restaurant_id=? AND type='low_stock'", [restaurantId]);
    expect(Number(low.c)).toBe(1); // 1050 - 150 = 900 <= 1000
    const events = await q<any>('SELECT event FROM order_events WHERE order_id=?', [ids.order]);
    expect(events.map((e) => e.event)).toEqual(expect.arrayContaining(['created', 'customer_edit', 'status:accepted', 'ticket:preparing', 'status:ready', 'status:served']));
  });

  it('customer uploads payment proof; it is not treated as paid until staff approves', async () => {
    const bill = (await cust.get('/api/v1/public/session/bill')).body.data;
    expect(bill.subtotal).toBe('80.0000');
    expect(bill.total).toBe('92.0000');
    ids.bill = bill.id;
    const bad = await cust.upload('/api/v1/public/session/payments').field('methodId', String(ids.method)).field('amount', '92').field('idempotencyKey', key()).attach('proof', Buffer.from('not an image'), { filename: 'x.png', contentType: 'image/png' });
    expect(bad.status).toBe(400);
    const pay = await cust.upload('/api/v1/public/session/payments').field('methodId', String(ids.method)).field('amount', '92.00').field('idempotencyKey', key()).attach('proof', await pngBuffer(), 'pay.png');
    expect(pay.status, JSON.stringify(pay.body)).toBe(201);
    const after = (await cust.get('/api/v1/public/session/bill')).body.data;
    expect(after.payment_status).toBe('under_review');
    expect(after.paid_total).toBe('0.0000');
    const pending = (await owner.get('/api/v1/r/payments/pending')).body.data;
    expect(pending[0].proofUrl).toContain('sig=');
    // private proof is not public
    const pub = await request(app).get(pending[0].proofUrl.split('?')[0]);
    expect(pub.status).toBe(403);
    const signed = await request(app).get(pending[0].proofUrl);
    expect(signed.status).toBe(200);
    const ap = await owner.post(`/api/v1/r/payments/${pending[0].id}/approve`, {});
    expect(ap.status, JSON.stringify(ap.body)).toBe(200);
    const closed = await one<any>('SELECT status, payment_status FROM bills WHERE id=?', [ids.bill]);
    expect(closed).toMatchObject({ status: 'closed', payment_status: 'paid' });
  });

  it('ledger balances and P&L reflects revenue excluding the tax liability', async () => {
    const health = (await owner.get('/api/v1/r/ledger/health')).body.data;
    expect(health.balanced).toBe(true);
    expect(health.billsMissingLedger).toBe(0);
    const pnl = (await owner.get('/api/v1/r/ledger/pnl?preset=today')).body.data.pnl;
    expect(pnl.sales).toBe('80.0000');
    expect(pnl.serviceRevenue).toBe('4.0000');
    expect(pnl.taxesCollected).toBe('8.0000');
    expect(pnl.cogs).toBe('12.0000'); // 4 pizzas × 150g × 0.02
    expect(pnl.netProfit).toBe('72.0000');
    const tax = (await owner.get('/api/v1/r/reports/tax?preset=today')).body.data;
    expect(tax.summary.find((s: any) => s.label === 'GST').value).toBe('8.0000');
    const pdf = await owner.get('/api/v1/r/reports/sales?preset=today&format=pdf');
    expect(pdf.headers['content-type']).toContain('application/pdf');
    const xlsx = await owner.get('/api/v1/r/reports/pnl?preset=today&format=xlsx');
    expect(xlsx.status).toBe(200);
  });

  it('re-scanning the same QR returns the closed state, then can start a new session', async () => {
    const again = await request(app).post(`/api/v1/public/qr/${tableToken}/session`).send({ name: 'Nouman', existingToken: cust.token });
    expect(again.body.data.state).toBe('closed');
    const fresh = await request(app).post(`/api/v1/public/qr/${tableToken}/session`).send({ name: 'Nouman', phone: '+15551234567', startNew: true });
    expect(fresh.status).toBe(201);
    expect(fresh.body.data.greeting).toMatch(/^Welcome back, Nouman!/);
  });

  it('customer can leave feedback after being served', async () => {
    expect((await cust.post('/api/v1/public/session/feedback', { rating: 5, comment: 'Great', publishPermission: true })).status).toBe(201);
  });
});

describe('4. POS & online ordering', () => {
  it('POS sale with split payments is idempotent and reconciles', async () => {
    expect((await owner.post('/api/v1/r/pos/shift/open', { openingCash: '100' })).status).toBe(201);
    const k = key();
    const body = { idempotencyKey: k, orderType: 'takeaway', customerName: 'Walk-in', lines: [{ itemId: ids.item2, quantity: 2 }], taxSelection: [],
      payments: [{ methodType: 'cash', amount: '10.00' }, { methodType: 'card', amount: '7.60' }], cashTendered: '20' };
    const a = await owner.post('/api/v1/r/pos/sales', body);
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body.data.bill.status).toBe('closed');
    expect(a.body.data.change).toBe('10.0000');
    // paying at the counter must not remove the order from the kitchen
    const kt = await one<any>("SELECT kt.status FROM kitchen_tickets kt JOIN orders o ON o.id=kt.order_id WHERE o.id=?", [a.body.data.orderId]);
    expect(kt.status).toBe('new');
    await owner.post(`/api/v1/r/orders/${a.body.data.orderId}/status`, { status: 'ready' });
    await owner.post(`/api/v1/r/orders/${a.body.data.orderId}/status`, { status: 'served' });
    expect((await one<any>('SELECT status FROM orders WHERE id=?', [a.body.data.orderId])).status).toBe('completed');
    const b = await owner.post('/api/v1/r/pos/sales', body);
    expect(b.body.duplicate).toBe(true);
    const count = await one<any>("SELECT COUNT(*) c FROM orders WHERE restaurant_id=? AND channel='pos'", [restaurantId]);
    expect(Number(count.c)).toBe(1);
    const refund = await owner.post(`/api/v1/r/bills/${a.body.data.bill.id}/refund`, { amount: '2.20', reason: 'Burnt', methodType: 'cash' });
    expect(refund.status, JSON.stringify(refund.body)).toBe(201);
    const close = await owner.post('/api/v1/r/pos/shift/close', { countedCash: '107.80' });
    expect(close.body.data.expectedCash).toBe('107.8000');
    expect(close.body.data.difference).toBe('0.0000');
    expect((await owner.get('/api/v1/r/ledger/health')).body.data.balanced).toBe(true);
  });

  it('hold and resume an order; split preview', async () => {
    const h = await owner.post('/api/v1/r/pos/sales', { idempotencyKey: key(), orderType: 'dine_in', tableId: ids.table, lines: [{ itemId: ids.item, quantity: 1 }, { itemId: ids.item2, quantity: 1 }], hold: true });
    expect(h.body.data.held).toBe(true);
    const held = (await owner.get('/api/v1/r/pos/held')).body.data;
    expect(held.length).toBe(1);
    expect((await owner.post(`/api/v1/r/pos/held/${held[0].id}/resume`, {})).status).toBe(200);
    const split = await owner.post(`/api/v1/r/bills/${h.body.data.bill.id}/split-preview`, { mode: 'equal', parts: 3 });
    const sum = split.body.data.parts.reduce((s: any, p: string) => s.plus(D(p)), D(0));
    expect(sum.toFixed(4)).toBe(split.body.data.balanceDue);
  });

  it('online storefront order (pickup) is separate from dine-in and uses the same menu', async () => {
    const slug = (await one<any>('SELECT slug FROM restaurants WHERE id=?', [restaurantId])).slug;
    const sf = await request(app).get(`/api/v1/public/restaurants/${slug}`);
    expect(sf.body.data.ordering.onlineOpen).toBe(true);
    const s = await request(app).post(`/api/v1/public/restaurants/${slug}/online-session`).send({ name: 'Online Olga', orderType: 'pickup' });
    expect(s.status).toBe(201);
    const oc = new Customer(app); oc.token = s.body.data.token;
    const o = await oc.post('/api/v1/public/session/orders', { idempotencyKey: key(), lines: [{ itemId: ids.item, quantity: 1 }] });
    expect(o.status, JSON.stringify(o.body)).toBe(201);
    const row = await one<any>('SELECT channel, order_type, table_id FROM orders WHERE public_id=?', [o.body.data.orderId]);
    expect(row).toMatchObject({ channel: 'online', order_type: 'pickup', table_id: null });
    await owner.patch('/api/v1/r/settings', { settings: { onlineOrderingOpen: false } });
    const closed = await oc.post('/api/v1/public/session/orders', { idempotencyKey: key(), lines: [{ itemId: ids.item, quantity: 1 }] });
    expect(closed.status).toBe(409);
    // dine-in still works while online is closed
    const scan = await request(app).get(`/api/v1/public/qr/${tableToken}`);
    expect(scan.status).toBe(200);
    await owner.patch('/api/v1/r/settings', { settings: { onlineOrderingOpen: true } });
  });

  it('waiter creates an order for a guest without a smartphone; wastage approval moves stock & ledger', async () => {
    const roles = (await owner.get('/api/v1/r/roles')).body.data;
    const waiterRole = roles.find((r: any) => r.system_key === 'waiter');
    await owner.post('/api/v1/r/staff', { name: 'Wendy', email: 'wendy@resto-a.test', password: 'WaiterPass123', roleId: waiterRole.id });
    const waiter = new Client(app); await waiter.login('wendy@resto-a.test', 'WaiterPass123');
    const t2 = (await owner.post('/api/v1/r/tables', { name: 'Table 2', table_number: '2', capacity: 2 })).body.data.id;
    const o = await waiter.post('/api/v1/r/orders', { idempotencyKey: key(), tableId: t2, customerName: 'Grandpa Joe', lines: [{ itemId: ids.item2, quantity: 1 }] });
    expect(o.status, JSON.stringify(o.body)).toBe(201);
    expect(o.body.data.status).toBe('accepted');
    // privilege escalation attempts
    expect((await waiter.get('/api/v1/r/payroll')).status).toBe(403);
    expect((await waiter.post('/api/v1/r/roles', { name: 'Hacker', permissions: ['staff.manage'] })).status).toBe(403);
    expect((await waiter.patch(`/api/v1/r/staff/${(await one<any>('SELECT id FROM users WHERE email=?', ['wendy@resto-a.test'])).id}`, { roleId: roles.find((r: any) => r.system_key === 'owner').id })).status).toBe(403);
    const before = D((await one<any>('SELECT stock_qty FROM ingredients WHERE id=?', [ids.cheese])).stock_qty);
    const w = await owner.post('/api/v1/r/wastage', { kind: 'expired', ingredientId: ids.cheese, quantity: '100', reason: 'Expired pack' });
    expect(w.status).toBe(201);
    expect((await owner.post(`/api/v1/r/wastage/${w.body.data.id}/approve`, {})).status).toBe(200);
    const after = D((await one<any>('SELECT stock_qty FROM ingredients WHERE id=?', [ids.cheese])).stock_qty);
    expect(before.minus(after).toFixed(0)).toBe('100');
    const pnl = (await owner.get('/api/v1/r/ledger/pnl?preset=today')).body.data.pnl;
    expect(pnl.wastage).toBe('2.0000');
  });

  it('cancellation reverses inventory', async () => {
    const before = D((await one<any>('SELECT stock_qty FROM ingredients WHERE id=?', [ids.cheese])).stock_qty);
    const o = await owner.post('/api/v1/r/orders', { idempotencyKey: key(), orderType: 'takeaway', customerName: 'X', lines: [{ itemId: ids.item, quantity: 2 }] });
    const mid = D((await one<any>('SELECT stock_qty FROM ingredients WHERE id=?', [ids.cheese])).stock_qty);
    expect(before.minus(mid).toFixed(0)).toBe('300');
    await owner.post(`/api/v1/r/orders/${o.body.data.id}/status`, { status: 'cancelled', reason: 'Customer left' });
    const after = D((await one<any>('SELECT stock_qty FROM ingredients WHERE id=?', [ids.cheese])).stock_qty);
    expect(after.toFixed(4)).toBe(before.toFixed(4));
    expect((await owner.get('/api/v1/r/ledger/health')).body.data.balanced).toBe(true);
  });

  it('billing discrepancy: neutral does not affect profit, loss does, reclassification is audited', async () => {
    const p0 = (await owner.get('/api/v1/r/ledger/pnl?preset=today')).body.data.pnl.netProfit;
    const d = await owner.post('/api/v1/r/discrepancies', { amount: '5', reason: 'Till short', occurredAt: new Date().toISOString(), classification: 'neutral' });
    expect(d.status).toBe(201);
    expect((await owner.get('/api/v1/r/ledger/pnl?preset=today')).body.data.pnl.netProfit).toBe(p0);
    await owner.post(`/api/v1/r/discrepancies/${d.body.data.id}/classify`, { classification: 'loss' });
    expect((await owner.get('/api/v1/r/ledger/pnl?preset=today')).body.data.pnl.netProfit).toBe(D(p0).minus(5).toFixed(4));
    const a = await one<any>("SELECT COUNT(*) c FROM audit_logs WHERE action='discrepancy.reclassify' AND restaurant_id=?", [restaurantId]);
    expect(Number(a.c)).toBe(1);
  });
});

describe('5. security', () => {
  it('enforces tenant isolation on every resource type', async () => {
    for (const url of [`/api/v1/r/orders/${ids.order}`, `/api/v1/r/bills/${ids.bill}`, `/api/v1/r/items/${ids.item}`, `/api/v1/r/tables/${ids.table}/qr?format=json`, `/api/v1/r/ingredients/${ids.cheese}`]) {
      const r = await ownerB.get(url);
      expect(r.status, url).toBe(404);
    }
    expect((await ownerB.patch(`/api/v1/r/items/${ids.item}`, { price: '0.01' })).status).toBe(404);
    expect((await ownerB.post(`/api/v1/r/orders/${ids.order}/status`, { status: 'completed' })).status).toBe(404);
    // foreign keys from another tenant are rejected
    const catB = (await ownerB.post('/api/v1/r/categories', { name: 'B cat' })).body.data.id;
    expect((await owner.post('/api/v1/r/items', { category_id: catB, name: 'X', price: '1' })).status).toBe(400);
    // B's staff cannot read A's private files
    const proof = await one<any>("SELECT public_id FROM files WHERE restaurant_id=? AND category='customer-payment-proofs' LIMIT 1", [restaurantId]);
    expect((await ownerB.get(`/api/v1/files/${proof.public_id}`)).status).toBe(403);
    // restaurant staff cannot reach platform endpoints
    expect((await owner.get('/api/v1/platform/restaurants')).status).toBe(403);
  });

  it('rejects state-changing requests without the CSRF token', async () => {
    const r = await owner.agent.post('/api/v1/r/categories').send({ name: 'No CSRF' });
    expect(r.status).toBe(403);
  });

  it('regenerating a QR revokes the old token immediately', async () => {
    await owner.post(`/api/v1/r/tables/${ids.table}/qr/regenerate`, {});
    expect((await request(app).get(`/api/v1/public/qr/${tableToken}`)).status).toBe(404);
    expect((await request(app).post(`/api/v1/public/qr/${tableToken}/session`).send({ name: 'Old QR' })).status).toBe(404);
  });

  it('locks accounts after repeated failed logins', async () => {
    for (let i = 0; i < 5; i++) await request(app).post('/api/v1/auth/login').send({ email: OWNER_B.email, password: 'wrong-password-1' });
    const r = await request(app).post('/api/v1/auth/login').send(OWNER_B);
    expect(r.status).toBe(401);
    expect(r.body.error.message).toMatch(/locked/);
    await exec('UPDATE users SET locked_until=NULL, failed_logins=0 WHERE email=?', [OWNER_B.email]);
  });

  it('password reset: generic response, single-use admin link, sessions revoked', async () => {
    const generic = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'nobody@nowhere.test' });
    expect(generic.status).toBe(200);
    const u = await one<any>('SELECT id FROM users WHERE email=?', [OWNER_B.email]);
    const issued = await admin.post(`/api/v1/platform/restaurants/${restaurantBId}/users/${u.id}/reset-link`, {});
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);
    // a restaurant id that does not own the user is refused
    expect((await admin.post(`/api/v1/platform/restaurants/${restaurantId}/users/${u.id}/reset-link`, {})).status).toBe(404);
    const token = new URL(issued.body.link).searchParams.get('token')!;
    const stored = await one<any>('SELECT token_hash FROM password_resets WHERE user_id=? ORDER BY id DESC LIMIT 1', [u.id]);
    expect(stored.token_hash).not.toBe(token);
    expect((await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'short' })).status).toBe(400);
    expect((await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'BrandNewPass789' })).status).toBe(200);
    expect((await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'AnotherPass789' })).status).toBe(400);
    expect((await ownerB.get('/api/v1/r/dashboard')).status).toBe(401);
    expect((await request(app).post('/api/v1/auth/login').send({ email: OWNER_B.email, password: 'BrandNewPass789' })).status).toBe(200);
    await exec('UPDATE users SET password_hash=? WHERE id=?', [await hashPassword(OWNER_B.password), u.id]);
    ownerB = new Client(app); await ownerB.login(OWNER_B.email, OWNER_B.password);
  });

  it('suspension blocks dashboard, customers, QR and invalidates sessions; reactivation restores', async () => {
    const newQr = (await owner.get(`/api/v1/r/tables/${ids.table}/qr?format=json`)).body.data.url.split('/t/')[1];
    await owner.patch('/api/v1/r/settings', { settings: { allowMultipleSessionsPerTable: true } });
    const c = new Customer(app);
    const started = await request(app).post(`/api/v1/public/qr/${newQr}/session`).send({ name: 'Late guest', startNew: true });
    expect(started.status, JSON.stringify(started.body)).toBe(201);
    c.token = started.body.data.token;
    expect((await admin.post(`/api/v1/platform/restaurants/${restaurantId}/suspend`, { reason: 'Policy violation' })).status).toBe(200);
    const me = await owner.get('/api/v1/auth/me');
    expect(me.body.user).toBeNull(); // staff session revoked
    expect((await c.get('/api/v1/public/session')).status).toBe(402); // customer blocked (session also expired server-side)
    expect((await one<any>('SELECT COUNT(*) c FROM customer_sessions WHERE restaurant_id=? AND status=\'active\'', [restaurantId])).c).toBe(0);
    const scan = await request(app).post(`/api/v1/public/qr/${newQr}/session`).send({ name: 'Someone' });
    expect(scan.status).toBe(402);
    expect(scan.body.error.details.deletionWarning).toMatch(/scheduled for deletion in 3 months/);
    const relogin = new Client(app); await relogin.login(OWNER.email, OWNER.password);
    expect((await relogin.get('/api/v1/r/dashboard')).status).toBe(402);
    expect((await admin.post(`/api/v1/platform/restaurants/${restaurantId}/reactivate`, {})).status).toBe(200);
    expect((await relogin.get('/api/v1/r/dashboard')).status).toBe(200);
    owner = relogin;
  });

  it('expired subscriptions past the grace period are swept automatically', async () => {
    await exec('UPDATE restaurants SET subscription_expires_at=DATE_SUB(NOW(), INTERVAL 30 DAY), grace_days=7 WHERE id=?', [restaurantBId]);
    const { subscriptionSweep } = await import('../../src/jobs/scheduler.js');
    const r = await subscriptionSweep();
    expect(r.expired).toBeGreaterThanOrEqual(1);
    const b = await one<any>('SELECT status, deletion_scheduled_at FROM restaurants WHERE id=?', [restaurantBId]);
    expect(b.status).toBe('expired');
    expect(b.deletion_scheduled_at).toBeTruthy();
  });
});

describe('6. jobs & backups', () => {
  it('job runner is duplicate-safe', async () => {
    const { runJob } = await import('../../src/jobs/scheduler.js');
    let runs = 0;
    const k = `test:${Date.now()}`;
    const [a, b] = await Promise.all([runJob('t', k, async () => { runs++; await new Promise((r) => setTimeout(r, 200)); }), runJob('t', k, async () => { runs++; })]);
    expect([a, b].sort()).toEqual(['locked', 'success']);
    expect(await runJob('t', k, async () => { runs++; })).toBe('skipped');
    expect(runs).toBe(1);
  });

  it('database backup is created and verified', async () => {
    const { runBackupNow } = await import('../../src/jobs/backup.js');
    const r = await runBackupNow('database');
    expect(r.status, (r as any).error).toBe('verified');
    expect((r as any).sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('restaurant data export is produced with secrets removed', async () => {
    const r = await admin.post(`/api/v1/platform/restaurants/${restaurantId}/export`, {});
    expect(r.status).toBe(200);
    const b = await one<any>('SELECT file_path FROM backups WHERE id=?', [r.body.data.backupId]);
    const zlib = await import('node:zlib'); const fs = await import('node:fs');
    const json = JSON.parse(zlib.gunzipSync(fs.readFileSync(b.file_path)).toString());
    expect(json.users[0].password_hash).toBeUndefined();
    expect(json.orders.length).toBeGreaterThan(0);
  });
});
