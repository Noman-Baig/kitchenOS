import { Router } from 'express';
import { z } from 'zod';
import { exec, j, one, q, tx, pool } from '../../lib/db.js';
import { ah, idParam, pageParams, parse } from '../../lib/http.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { actorFromReq, audit } from '../../lib/audit.js';
import { hasPermission } from '../../lib/permissions.js';
import { requirePerm } from '../../middleware/auth.js';
import { zPosMoney, zId } from '../../lib/crud.js';
import { D } from '../../lib/money.js';
import { signFileUrl } from '../../lib/crypto.js';
import { cancelOrderItem, createOrder, orderDetail, transitionOrder, updateTicket, type OrderStatus } from '../../services/orders.js';
import { approvePayment, billView, closeBill, recomputeBill, recordStaffPayment, refundBill, rejectPayment, setBillAdjustments } from '../../services/bills.js';
import { calculateBill, splitByLines, splitCustom, splitEqual } from '../../services/billCalc.js';
import { invoicePdf, receiptEscPos, receiptText, type ReceiptData } from '../../services/documents.js';
import { getBranding, restaurantSettings } from '../../services/settings.js';
import { postTxn } from '../../services/ledger.js';
import { emit, rooms } from '../../realtime/bus.js';
import { notify } from '../../services/notify.js';
import { restaurantPublicAssets } from '../../services/restaurantStatus.js';

export const opsRouter = Router();

const zLine = z.object({
  itemId: zId, variantId: zId.nullable().optional(), addonIds: z.array(zId).max(20).optional(), quantity: z.number().int().min(1).max(99),
  notes: z.string().max(300).nullable().optional(), complimentary: z.boolean().optional(), complimentaryReason: z.string().max(300).nullable().optional(),
});

/* --------------------------------- Orders --------------------------------- */
opsRouter.get('/orders', requirePerm('orders.view'), ah(async (req, res) => {
  const { page, pageSize, offset } = pageParams(req);
  const w = ['o.restaurant_id=?']; const p: unknown[] = [req.restaurant.id];
  if (req.query.status) { const st = String(req.query.status).split(',').slice(0, 10); w.push('o.status IN (?)'); p.push(st); }
  if (req.query.channel) { w.push('o.channel=?'); p.push(String(req.query.channel)); }
  if (req.query.tableId) { w.push('o.table_id=?'); p.push(Number(req.query.tableId)); }
  if (req.query.branchId) { w.push('o.branch_id=?'); p.push(Number(req.query.branchId)); }
  if (req.query.active === '1') w.push("o.status IN ('pending_approval','submitted','accepted','preparing','ready')");
  if (req.query.from) { w.push('o.created_at>=?'); p.push(new Date(String(req.query.from))); }
  if (req.query.search) { w.push('(o.order_no LIKE ? OR o.customer_name LIKE ?)'); p.push(`%${req.query.search}%`, `%${req.query.search}%`); }
  const rows = await q<any>(`SELECT o.id, o.public_id, o.order_no, o.status, o.channel, o.order_type, o.table_id, t.name table_name, o.customer_name, o.customer_phone, o.subtotal, o.is_addition, o.parent_order_id,
      o.bill_id, o.created_at, o.accepted_at, o.ready_at, o.prep_estimate_minutes, o.editable_until, o.notes, o.delivery_address, o.scheduled_for, o.is_held,
      (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id AND oi.status<>'cancelled') item_count
    FROM orders o LEFT JOIN dining_tables t ON t.id=o.table_id WHERE ${w.join(' AND ')} ORDER BY o.id DESC LIMIT ? OFFSET ?`, [...p, pageSize, offset]);
  if (req.query.withItems === '1' && rows.length) {
    const items = await q<any>('SELECT order_id, id, name, variant_name, quantity, notes, status, addons, is_complimentary FROM order_items WHERE order_id IN (?)', [rows.map((r) => r.id)]);
    rows.forEach((r) => { r.items = items.filter((i) => i.order_id === r.id).map((i) => ({ ...i, addons: j(i.addons, []) })); });
  }
  res.json({ data: rows, page, pageSize });
}));
opsRouter.get('/orders/:id', requirePerm('orders.view'), ah(async (req, res) => { res.json({ data: await orderDetail(pool, req.restaurant.id, idParam(req)) }); }));

/** Staff-created order (waiter app or counter): for guests without a smartphone or a walk-in. */
opsRouter.post('/orders', requirePerm('orders.create'), ah(async (req, res) => {
  const b = parse(z.object({
    lines: z.array(zLine).min(1).max(50), orderType: z.enum(['dine_in', 'takeaway', 'delivery', 'pickup']).default('dine_in'), tableId: zId.nullable().optional(),
    customerName: z.string().min(1).max(190), customerPhone: z.string().max(40).nullable().optional(), customerId: zId.nullable().optional(),
    notes: z.string().max(500).nullable().optional(), idempotencyKey: z.string().min(8).max(80), channel: z.enum(['waiter', 'pos']).default('waiter'),
    deliveryAddress: z.string().max(500).nullable().optional(), branchId: zId.nullable().optional(),
  }), req.body);
  if (b.lines.some((l) => l.complimentary) && !hasPermission(req.user!.permissions, 'discounts.apply')) throw forbidden('Complimentary items require the discount permission');
  if (b.orderType === 'dine_in' && !b.tableId) throw badRequest('Select a table for dine-in orders');
  const out = await tx(async (db) => {
    let billId: number | null = null;
    if (b.tableId && b.orderType === 'dine_in') {
      const open = await one<any>("SELECT id FROM bills WHERE restaurant_id=? AND table_id=? AND status='open' ORDER BY id DESC LIMIT 1 FOR UPDATE", [req.restaurant.id, b.tableId], db);
      billId = open?.id ?? null;
    }
    return createOrder(db, {
      restaurant: req.restaurant, channel: b.channel, orderType: b.orderType, lines: b.lines, tableId: b.tableId, billId, branchId: b.branchId ?? req.user!.branchId,
      customerId: b.customerId, customerName: b.customerName, customerPhone: b.customerPhone, notes: b.notes, deliveryAddress: b.deliveryAddress,
      idempotencyKey: `s${req.user!.id}:${b.idempotencyKey}`, actor: actorFromReq(req),
    });
  });
  res.status(out.duplicate ? 200 : 201).json({ data: { id: out.order.id, orderNo: out.order.order_no, billId: out.order.bill_id, status: out.order.status } });
}));

/** Add items to an existing order's bill as a separate, auditable addition. */
opsRouter.post('/orders/:id/additions', requirePerm('orders.create'), ah(async (req, res) => {
  const b = parse(z.object({ lines: z.array(zLine).min(1).max(50), idempotencyKey: z.string().min(8).max(80), notes: z.string().max(500).nullable().optional() }), req.body);
  const parent = await one<any>('SELECT * FROM orders WHERE id=? AND restaurant_id=?', [idParam(req), req.restaurant.id]);
  if (!parent) throw notFound('Order');
  const out = await tx((db) => createOrder(db, {
    restaurant: req.restaurant, channel: parent.channel === 'qr' ? 'waiter' : parent.channel, orderType: parent.order_type, lines: b.lines, tableId: parent.table_id, billId: parent.bill_id,
    sessionId: parent.session_id, customerId: parent.customer_id, customerName: parent.customer_name, notes: b.notes, parentOrderId: parent.id,
    idempotencyKey: `s${req.user!.id}:${b.idempotencyKey}`, actor: actorFromReq(req), branchId: parent.branch_id,
  }));
  res.status(201).json({ data: { id: out.order.id, orderNo: out.order.order_no } });
}));

const transitionPerm: Record<string, 'orders.manage' | 'kitchen.update' | 'waiter.use' | 'pos.cancel'> = { accepted: 'orders.manage', rejected: 'orders.manage', cancelled: 'orders.manage', preparing: 'kitchen.update', ready: 'kitchen.update', served: 'waiter.use', completed: 'orders.manage' };
opsRouter.post('/orders/:id/status', ah(async (req, res) => {
  const b = parse(z.object({ status: z.enum(['accepted', 'rejected', 'preparing', 'ready', 'served', 'completed', 'cancelled']), reason: z.string().max(500).optional() }), req.body);
  const perm = transitionPerm[b.status];
  const perms = req.user!.permissions;
  if (!hasPermission(perms, perm) && !(b.status === 'served' && hasPermission(perms, 'orders.manage'))) throw forbidden(`Missing permission: ${perm}`);
  const order = await one<any>('SELECT status FROM orders WHERE id=? AND restaurant_id=?', [idParam(req), req.restaurant.id]);
  if (order && b.status === 'cancelled' && ['served', 'completed'].includes(order.status) && !hasPermission(perms, 'pos.cancel')) throw forbidden('Cancelling served orders requires pos.cancel');
  const o = await tx((db) => transitionOrder(db, req.restaurant, idParam(req), b.status as OrderStatus, actorFromReq(req), b.reason));
  res.json({ data: { id: o.id, status: o.status } });
}));

opsRouter.post('/order-items/:id/cancel', requirePerm('orders.manage'), ah(async (req, res) => {
  const b = parse(z.object({ reason: z.string().min(2).max(300) }), req.body);
  await tx((db) => cancelOrderItem(db, req.restaurant, idParam(req), b.reason, actorFromReq(req)));
  res.json({ ok: true });
}));
opsRouter.post('/order-items/:id/complimentary', requirePerm('discounts.apply'), ah(async (req, res) => {
  const b = parse(z.object({ reason: z.string().min(2).max(300) }), req.body);
  await tx(async (db) => {
    const it = await one<any>('SELECT oi.*, o.bill_id FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.id=? AND oi.restaurant_id=? FOR UPDATE', [idParam(req), req.restaurant.id], db);
    if (!it) throw notFound('Order item');
    if (it.stock_deducted) throw conflict('Mark items complimentary before stock is deducted, or record the giveaway as wastage');
    await exec('UPDATE order_items SET is_complimentary=1, complimentary_reason=?, line_total=0 WHERE id=?', [b.reason, it.id], db);
    await audit(actorFromReq(req), 'order_item.complimentary', 'order_item', it.id, { reason: b.reason, value: D(it.unit_price).times(it.quantity).toFixed(4) }, db);
    await recomputeBill(db, req.restaurant.id, it.bill_id);
  });
  res.json({ ok: true });
}));

/* --------------------------------- Kitchen --------------------------------- */
opsRouter.get('/kitchen/tickets', requirePerm('kitchen.view'), ah(async (req, res) => {
  const w = ["kt.restaurant_id=?", "kt.status IN ('new','preparing','ready')"]; const p: unknown[] = [req.restaurant.id];
  if (req.query.stationId) { w.push('kt.station_id=?'); p.push(Number(req.query.stationId)); }
  const rows = await q<any>(`SELECT kt.*, o.order_no, o.table_id, t.name table_name, o.channel, o.order_type, o.notes order_notes, o.prep_estimate_minutes, o.customer_name, o.is_addition, s.name station_name
    FROM kitchen_tickets kt JOIN orders o ON o.id=kt.order_id LEFT JOIN dining_tables t ON t.id=o.table_id LEFT JOIN kitchen_stations s ON s.id=kt.station_id
    WHERE ${w.join(' AND ')} ORDER BY kt.priority DESC, kt.created_at LIMIT 300`, p);
  const items = rows.length ? await q<any>("SELECT id, ticket_id, name, variant_name, addons, quantity, notes, status FROM order_items WHERE ticket_id IN (?) AND status<>'cancelled'", [rows.map((r) => r.id)]) : [];
  const delay = restaurantSettings(req.restaurant).kdsDelayMinutes;
  res.json({ data: rows.map((r) => ({ ...r, items: items.filter((i) => i.ticket_id === r.id).map((i) => ({ ...i, addons: j(i.addons, []) })), delayed: Date.now() - new Date(r.created_at).getTime() > Math.max(delay, r.prep_estimate_minutes || 0) * 60000 && r.status !== 'ready' })), settings: { sound: restaurantSettings(req.restaurant).kdsSound, delayMinutes: delay } });
}));
opsRouter.post('/kitchen/tickets/:id/status', requirePerm('kitchen.update'), ah(async (req, res) => {
  const b = parse(z.object({ status: z.enum(['preparing', 'ready']) }), req.body);
  const out = await tx((db) => updateTicket(db, req.restaurant, idParam(req), b.status, actorFromReq(req)));
  res.json({ data: { ticketStatus: b.status, orderStatus: out.order.status } });
}));
opsRouter.post('/kitchen/tickets/:id/priority', requirePerm('kitchen.update', 'orders.manage'), ah(async (req, res) => {
  const b = parse(z.object({ priority: z.number().int().min(0).max(9) }), req.body);
  await exec('UPDATE kitchen_tickets SET priority=? WHERE id=? AND restaurant_id=?', [b.priority, idParam(req), req.restaurant.id]);
  emit(rooms.staffPerm(req.restaurant.id, 'kitchen.view'), 'kds:ticket', { ticketId: idParam(req) });
  res.json({ ok: true });
}));

/* --------------------------------- Waiter tasks --------------------------------- */
opsRouter.get('/tasks', requirePerm('waiter.use', 'orders.manage'), ah(async (req, res) => {
  const mine = req.query.mine === '1' || !hasPermission(req.user!.permissions, 'orders.manage');
  const rows = await q<any>(`SELECT wt.*, t.name table_name, u.name assignee FROM waiter_tasks wt LEFT JOIN dining_tables t ON t.id=wt.table_id LEFT JOIN users u ON u.id=wt.assigned_to
    WHERE wt.restaurant_id=? ${mine ? 'AND (wt.assigned_to=? OR wt.assigned_to IS NULL)' : ''} AND (wt.status NOT IN ('completed','cancelled') OR wt.updated_at>DATE_SUB(NOW(), INTERVAL 1 DAY)) ORDER BY wt.id DESC LIMIT 200`, mine ? [req.restaurant.id, req.user!.id] : [req.restaurant.id]);
  res.json({ data: rows });
}));
opsRouter.post('/tasks', requirePerm('waiter.use', 'orders.manage'), ah(async (req, res) => {
  const b = parse(z.object({ title: z.string().min(2).max(300), details: z.string().max(1000).nullable().optional(), tableId: zId.nullable().optional(), assignedTo: zId.nullable().optional(), kind: z.enum(['task', 'issue']).default('task') }), req.body);
  if (b.kind === 'task' && b.assignedTo && !hasPermission(req.user!.permissions, 'orders.manage')) throw forbidden('Only managers can assign tasks');
  if (b.tableId && !(await one('SELECT id FROM dining_tables WHERE id=? AND restaurant_id=?', [b.tableId, req.restaurant.id]))) throw badRequest('Invalid table');
  if (b.assignedTo && !(await one('SELECT id FROM users WHERE id=? AND restaurant_id=? AND active=1', [b.assignedTo, req.restaurant.id]))) throw badRequest('Invalid staff member');
  const r = await exec('INSERT INTO waiter_tasks (restaurant_id, assigned_to, table_id, title, details, kind, created_by) VALUES (?,?,?,?,?,?,?)', [req.restaurant.id, b.assignedTo ?? null, b.tableId ?? null, b.title, b.details ?? null, b.kind, req.user!.id]);
  if (b.assignedTo) await notify({ restaurantId: req.restaurant.id, userId: b.assignedTo, type: 'task_assigned', title: b.title, body: b.details || '', data: { taskId: r.insertId } });
  else emit(rooms.staffPerm(req.restaurant.id, b.kind === 'issue' ? 'orders.manage' : 'waiter.use'), 'task:new', { id: r.insertId, title: b.title });
  res.status(201).json({ data: { id: r.insertId } });
}));
opsRouter.post('/tasks/:id/status', requirePerm('waiter.use', 'orders.manage'), ah(async (req, res) => {
  const b = parse(z.object({ status: z.enum(['accepted', 'in_progress', 'completed', 'cancelled']) }), req.body);
  const t = await one<any>('SELECT * FROM waiter_tasks WHERE id=? AND restaurant_id=?', [idParam(req), req.restaurant.id]);
  if (!t) throw notFound('Task');
  if (t.assigned_to && t.assigned_to !== req.user!.id && !hasPermission(req.user!.permissions, 'orders.manage')) throw forbidden('This task is assigned to someone else');
  await exec('UPDATE waiter_tasks SET status=?, assigned_to=COALESCE(assigned_to, ?) WHERE id=?', [b.status, req.user!.id, t.id]);
  emit(rooms.staffPerm(req.restaurant.id, 'orders.manage'), 'task:updated', { id: t.id, status: b.status });
  res.json({ ok: true });
}));

/* --------------------------------- Support / chat / calls --------------------------------- */
opsRouter.get('/support', requirePerm('support.handle'), ah(async (req, res) => {
  const rows = await q<any>(`SELECT s.*, t.name table_name, cs.customer_name FROM support_requests s LEFT JOIN dining_tables t ON t.id=s.table_id LEFT JOIN customer_sessions cs ON cs.id=s.session_id
    WHERE s.restaurant_id=? AND (s.status<>'resolved' OR s.created_at>DATE_SUB(NOW(), INTERVAL 6 HOUR)) ORDER BY s.status='resolved', s.id DESC LIMIT 200`, [req.restaurant.id]);
  res.json({ data: rows });
}));
opsRouter.post('/support/:id/status', requirePerm('support.handle'), ah(async (req, res) => {
  const b = parse(z.object({ status: z.enum(['acknowledged', 'resolved']) }), req.body);
  const s = await one<any>('SELECT * FROM support_requests WHERE id=? AND restaurant_id=?', [idParam(req), req.restaurant.id]);
  if (!s) throw notFound('Request');
  await exec(`UPDATE support_requests SET status=?, handled_by=?${b.status === 'resolved' ? ', resolved_at=NOW(3)' : ''} WHERE id=?`, [b.status, req.user!.id, s.id]);
  if (s.session_id) emit(rooms.session(s.session_id), 'support:updated', { id: s.id, status: b.status, by: req.user!.name });
  emit(rooms.staffPerm(req.restaurant.id, 'support.handle'), 'support:updated', { id: s.id, status: b.status });
  res.json({ ok: true });
}));
opsRouter.get('/chats', requirePerm('support.handle'), ah(async (req, res) => {
  const rows = await q<any>(`SELECT cs.id session_id, cs.customer_name, cs.table_id, t.name table_name, cs.status, MAX(m.id) last_id, MAX(m.created_at) last_at,
      SUM(CASE WHEN m.sender_type='customer' AND m.read_at IS NULL THEN 1 ELSE 0 END) unread
    FROM chat_messages m JOIN customer_sessions cs ON cs.id=m.session_id LEFT JOIN dining_tables t ON t.id=cs.table_id
    WHERE m.restaurant_id=? AND m.created_at>DATE_SUB(NOW(), INTERVAL 1 DAY) GROUP BY cs.id ORDER BY last_id DESC LIMIT 100`, [req.restaurant.id]);
  res.json({ data: rows });
}));
opsRouter.get('/chats/:sessionId', requirePerm('support.handle'), ah(async (req, res) => {
  const sid = idParam(req, 'sessionId');
  const s = await one('SELECT id FROM customer_sessions WHERE id=? AND restaurant_id=?', [sid, req.restaurant.id]);
  if (!s) throw notFound('Session');
  await exec("UPDATE chat_messages SET read_at=NOW(3) WHERE session_id=? AND sender_type='customer' AND read_at IS NULL", [sid]);
  res.json({ data: await q('SELECT m.id, m.sender_type, m.body, m.created_at, u.name staff_name FROM chat_messages m LEFT JOIN users u ON u.id=m.sender_user_id WHERE m.session_id=? AND m.restaurant_id=? ORDER BY m.id LIMIT 500', [sid, req.restaurant.id]) });
}));
opsRouter.post('/chats/:sessionId', requirePerm('support.handle'), ah(async (req, res) => {
  const sid = idParam(req, 'sessionId');
  const b = parse(z.object({ body: z.string().trim().min(1).max(2000) }), req.body);
  const s = await one<any>("SELECT id FROM customer_sessions WHERE id=? AND restaurant_id=?", [sid, req.restaurant.id]);
  if (!s) throw notFound('Session');
  const r = await exec("INSERT INTO chat_messages (restaurant_id, session_id, sender_type, sender_user_id, body) VALUES (?,?,'staff',?,?)", [req.restaurant.id, sid, req.user!.id, b.body]);
  const msg = { id: r.insertId, sessionId: sid, sender_type: 'staff', body: b.body, created_at: new Date(), staff_name: req.user!.name };
  emit(rooms.session(sid), 'chat:message', msg);
  emit(rooms.staffPerm(req.restaurant.id, 'support.handle'), 'chat:message', msg);
  res.status(201).json({ data: msg });
}));
opsRouter.get('/calls', requirePerm('support.handle', 'calls.receive'), ah(async (req, res) => {
  res.json({ data: await q('SELECT c.*, t.name table_name, cs.customer_name, u.name staff_name FROM call_records c LEFT JOIN dining_tables t ON t.id=c.table_id LEFT JOIN customer_sessions cs ON cs.id=c.session_id LEFT JOIN users u ON u.id=c.staff_user_id WHERE c.restaurant_id=? ORDER BY c.id DESC LIMIT 200', [req.restaurant.id]) });
}));

opsRouter.get('/ice-servers', requirePerm('calls.receive'), ah(async (req, res) => {
  const { config } = await import('../../config.js');
  const { turnCredentials } = await import('../../lib/crypto.js');
  const turn = turnCredentials(`s${req.user!.id}`);
  const iceServers: any[] = [{ urls: config.webrtc.stunUrls }];
  if (turn && config.webrtc.turnUrls.length) iceServers.push({ urls: config.webrtc.turnUrls, username: turn.username, credential: turn.credential });
  res.json({ data: { iceServers } });
}));

/* --------------------------------- Bills & payments --------------------------------- */
opsRouter.get('/bills', requirePerm('billing.view'), ah(async (req, res) => {
  const { page, pageSize, offset } = pageParams(req);
  const w = ['b.restaurant_id=?']; const p: unknown[] = [req.restaurant.id];
  if (req.query.status) { w.push('b.status=?'); p.push(String(req.query.status)); }
  if (req.query.paymentStatus) { w.push('b.payment_status=?'); p.push(String(req.query.paymentStatus)); }
  if (req.query.tableId) { w.push('b.table_id=?'); p.push(Number(req.query.tableId)); }
  if (req.query.search) { w.push('(b.bill_no LIKE ? OR b.customer_name LIKE ?)'); p.push(`%${req.query.search}%`, `%${req.query.search}%`); }
  const rows = await q<any>(`SELECT b.id, b.bill_no, b.status, b.payment_status, b.channel, b.order_type, b.customer_name, b.table_id, t.name table_name, b.total, b.paid_total, b.refunded_total, b.opened_at, b.closed_at
     FROM bills b LEFT JOIN dining_tables t ON t.id=b.table_id WHERE ${w.join(' AND ')} ORDER BY b.id DESC LIMIT ? OFFSET ?`, [...p, pageSize, offset]);
  res.json({ data: rows, page, pageSize });
}));
opsRouter.get('/bills/:id', requirePerm('billing.view'), ah(async (req, res) => {
  const v = await billView(pool, req.restaurant.id, idParam(req), { includeProofs: true });
  v.payments = v.payments.map((p: any) => ({ ...p, proofUrl: p.proof_public_id ? signFileUrl(p.proof_public_id, 600) : null, proof_public_id: undefined }));
  const taxes = await q('SELECT id, name, rate, calc_type, is_optional, default_selected FROM taxes WHERE restaurant_id=? AND enabled=1 ORDER BY sort_order, id', [req.restaurant.id]);
  res.json({ data: { ...v, availableTaxes: taxes } });
}));
opsRouter.post('/bills/:id/adjust', requirePerm('billing.view'), ah(async (req, res) => {
  const b = parse(z.object({ taxSelection: z.array(zId).max(50).nullable().optional(), discount: z.object({ type: z.enum(['percent', 'fixed']), value: zPosMoney }).nullable().optional(), couponCode: z.string().max(40).nullable().optional() }), req.body);
  if ((b.discount || b.couponCode) && !hasPermission(req.user!.permissions, 'discounts.apply')) throw forbidden('Applying discounts requires permission');
  if (b.taxSelection !== undefined && !hasPermission(req.user!.permissions, 'payments.approve')) throw forbidden('Changing taxes requires payment approval permission');
  await tx((db) => setBillAdjustments(db, req.restaurant.id, idParam(req), actorFromReq(req), b));
  res.json({ ok: true });
}));
opsRouter.post('/bills/:id/split-preview', requirePerm('billing.view'), ah(async (req, res) => {
  const b = parse(z.object({ mode: z.enum(['equal', 'items', 'custom']), parts: z.number().int().min(2).max(50).optional(), groups: z.array(z.array(z.number().int())).max(50).optional(), amounts: z.array(zPosMoney).max(50).optional() }), req.body);
  const bill = await billView(pool, req.restaurant.id, idParam(req));
  const due = D(bill.total).minus(D(bill.paid_total));
  let parts: string[];
  try {
    if (b.mode === 'equal') parts = splitEqual(due, b.parts ?? 2, bill.currency);
    else if (b.mode === 'custom') parts = splitCustom(due, b.amounts ?? []);
    else {
      const lines = bill.orders.flatMap((o: any) => (['rejected', 'cancelled'].includes(o.status) ? [] : o.items.filter((i: any) => i.status !== 'cancelled')));
      const taxes = await q<any>('SELECT * FROM taxes WHERE restaurant_id=? AND enabled=1', [req.restaurant.id]);
      const sel = bill.tax_selection;
      const calc = calculateBill({ currency: bill.currency, orderType: bill.order_type, discount: bill.discount, deliveryCharge: bill.delivery_charge,
        lines: lines.map((l: any) => ({ key: l.id, itemId: l.menu_item_id, categoryId: 0, unitPrice: l.unit_price, addonsTotal: l.addons_total, quantity: l.quantity, complimentary: !!l.is_complimentary })),
        taxes: taxes.map((t) => ({ id: t.id, name: t.name, calcType: t.calc_type, rate: t.rate, inclusive: !!t.inclusive, isLiability: !!t.is_liability, appliesTo: j(t.applies_to, null), orderTypes: j(t.order_types, null), selected: t.is_optional ? (sel ? sel.includes(t.id) : !!t.default_selected) : true })) });
      if (D(bill.paid_total).gt(0)) throw new Error('Split by items is only available before any payment is recorded');
      parts = splitByLines(calc, b.groups ?? [], bill.currency);
    }
  } catch (e: any) { throw badRequest(e.message); }
  res.json({ data: { parts, balanceDue: due.toFixed(4) } });
}));
opsRouter.post('/bills/:id/payments', requirePerm('payments.approve', 'pos.use'), ah(async (req, res) => {
  const b = parse(z.object({ methodType: z.enum(['cash', 'bank', 'wallet', 'card', 'other']), methodId: zId.nullable().optional(), amount: zPosMoney, reference: z.string().max(190).nullable().optional(), splitLabel: z.string().max(80).nullable().optional(), idempotencyKey: z.string().min(8).max(80) }), req.body);
  const shift = await one<any>('SELECT id FROM pos_shifts WHERE restaurant_id=? AND user_id=? AND closed_at IS NULL', [req.restaurant.id, req.user!.id]);
  const out = await tx(async (db) => {
    const id = await recordStaffPayment(db, req.restaurant.id, idParam(req), actorFromReq(req), { ...b, shiftId: shift?.id, idempotencyKey: `s${req.user!.id}:${b.idempotencyKey}` });
    const bill = await one<any>('SELECT total, paid_total, status FROM bills WHERE id=?', [idParam(req)], db);
    if (bill.status === 'open' && D(bill.paid_total).gte(D(bill.total)) && D(bill.total).gt(0)) await closeBill(db, req.restaurant.id, idParam(req), actorFromReq(req), {});
    return id;
  });
  res.status(201).json({ data: { paymentId: out } });
}));
opsRouter.post('/payments/:id/approve', requirePerm('payments.approve'), ah(async (req, res) => {
  const b = parse(z.object({ amount: zPosMoney.optional() }), req.body || {});
  const shift = await one<any>('SELECT id FROM pos_shifts WHERE restaurant_id=? AND user_id=? AND closed_at IS NULL', [req.restaurant.id, req.user!.id]);
  res.json({ data: await tx((db) => approvePayment(db, req.restaurant.id, idParam(req), actorFromReq(req), { amount: b.amount, shiftId: shift?.id })) });
}));
opsRouter.post('/payments/:id/reject', requirePerm('payments.approve'), ah(async (req, res) => {
  const b = parse(z.object({ reason: z.string().min(2).max(500) }), req.body);
  await tx((db) => rejectPayment(db, req.restaurant.id, idParam(req), b.reason, actorFromReq(req)));
  res.json({ ok: true });
}));
opsRouter.get('/payments/pending', requirePerm('payments.approve'), ah(async (req, res) => {
  const rows = await q<any>(`SELECT p.*, b.bill_no, b.total bill_total, b.paid_total, t.name table_name, b.customer_name, m.label method_label, f.public_id proof_public_id FROM payments p JOIN bills b ON b.id=p.bill_id
    LEFT JOIN dining_tables t ON t.id=b.table_id LEFT JOIN payment_methods m ON m.id=p.method_id LEFT JOIN files f ON f.id=p.proof_file_id
    WHERE p.restaurant_id=? AND p.status IN ('submitted','under_review','cash_requested') ORDER BY p.id`, [req.restaurant.id]);
  res.json({ data: rows.map((r) => ({ ...r, proofUrl: r.proof_public_id ? signFileUrl(r.proof_public_id, 600) : null, proof_public_id: undefined })) });
}));
opsRouter.post('/bills/:id/close', requirePerm('payments.approve'), ah(async (req, res) => {
  const b = parse(z.object({ force: z.boolean().optional(), reason: z.string().max(500).optional() }), req.body || {});
  await tx((db) => closeBill(db, req.restaurant.id, idParam(req), actorFromReq(req), b));
  res.json({ ok: true });
}));
opsRouter.post('/bills/:id/refund', requirePerm('pos.refund'), ah(async (req, res) => {
  const b = parse(z.object({ amount: zPosMoney, reason: z.string().min(2).max(500), methodType: z.enum(['cash', 'bank', 'wallet', 'card', 'other']), restock: z.boolean().optional() }), req.body);
  const shift = await one<any>('SELECT id FROM pos_shifts WHERE restaurant_id=? AND user_id=? AND closed_at IS NULL', [req.restaurant.id, req.user!.id]);
  const id = await tx((db) => refundBill(db, req.restaurant.id, idParam(req), actorFromReq(req), { ...b, shiftId: shift?.id }));
  res.status(201).json({ data: { refundId: id } });
}));
opsRouter.post('/bills/:id/void', requirePerm('pos.cancel'), ah(async (req, res) => {
  const b = parse(z.object({ reason: z.string().min(2).max(500) }), req.body);
  await tx(async (db) => {
    const bill = await one<any>('SELECT * FROM bills WHERE id=? AND restaurant_id=? FOR UPDATE', [idParam(req), req.restaurant.id], db);
    if (!bill) throw notFound('Bill');
    if (bill.status !== 'open') throw conflict('Only open bills can be voided; use refunds for closed bills');
    if (D(bill.paid_total).gt(0)) throw conflict('Bill has payments; refund or reject them first');
    const orders = await q<any>("SELECT id FROM orders WHERE bill_id=? AND status NOT IN ('cancelled','rejected','completed')", [bill.id], db);
    for (const o of orders) {
      const cur = await one<any>('SELECT status FROM orders WHERE id=?', [o.id], db);
      if (cur.status === 'draft' || cur.status === 'served') await exec("UPDATE orders SET status='cancelled', cancelled_at=NOW(3), rejection_reason=? WHERE id=?", [b.reason, o.id], db);
      else await transitionOrder(db, req.restaurant, o.id, 'cancelled', actorFromReq(req), b.reason);
    }
    await exec("UPDATE bills SET status='void', closed_at=NOW(3), closed_by=? WHERE id=?", [req.user!.id, bill.id], db);
    await exec("UPDATE customer_sessions SET status='closed', closed_at=NOW(3) WHERE bill_id=? AND status='active'", [bill.id], db);
    await audit(actorFromReq(req), 'bill.void', 'bill', bill.id, { reason: b.reason }, db);
  });
  res.json({ ok: true });
}));

async function receiptData(restaurant: any, billId: number, cashierName: string): Promise<ReceiptData> {
  const v = await billView(pool, restaurant.id, billId);
  const branding = await getBranding();
  const table = v.table_id ? await one<any>('SELECT name FROM dining_tables WHERE id=?', [v.table_id]) : null;
  const methods = await q<any>('SELECT id, label FROM payment_methods WHERE restaurant_id=?', [restaurant.id]);
  const lines = v.orders.filter((o: any) => !['rejected', 'cancelled', 'draft'].includes(o.status)).flatMap((o: any) => o.items.filter((i: any) => i.status !== 'cancelled').map((i: any) => ({
    name: `${i.name}${i.variant_name ? ' (' + i.variant_name + ')' : ''}${i.addons?.length ? ' + ' + i.addons.map((a: any) => a.name).join(', ') : ''}`,
    qty: i.quantity, unit: D(i.unit_price).plus(D(i.addons_total)).toFixed(4), total: i.line_total, complimentary: !!i.is_complimentary,
  })));
  const paid = v.payments.filter((p: any) => p.status === 'approved' || p.status === 'cash_collected');
  return {
    restaurant: { name: restaurant.name, address: restaurant.address, phone: restaurant.contact_phone, email: restaurant.contact_email, logoFileId: restaurant.logo_file_id },
    billNo: v.bill_no, dateText: new Intl.DateTimeFormat(restaurant.locale || 'en', { dateStyle: 'medium', timeStyle: 'short', timeZone: restaurant.timezone }).format(new Date(v.closed_at || v.opened_at)),
    cashier: cashierName, tableText: table ? `Table: ${table.name}` : null, orderType: v.order_type, currency: v.currency, locale: restaurant.locale,
    lines, subtotal: v.subtotal, discount: v.discount_total, taxes: v.taxes.map((t: any) => ({ name: t.name, rate: t.rate, amount: t.amount, inclusive: !!t.inclusive })),
    deliveryCharge: v.delivery_charge, total: v.total, paid: v.paid_total, balance: v.balance_due,
    payments: paid.map((p: any) => ({ method: methods.find((m) => m.id === p.method_id)?.label || p.method_type, amount: p.amount })),
    footer: restaurantSettings(restaurant).receiptFooter, poweredBy: branding.softwareName,
  };
}
opsRouter.get('/bills/:id/receipt', requirePerm('billing.view', 'pos.use'), ah(async (req, res) => {
  const d = await receiptData(req.restaurant, idParam(req), req.user!.name);
  const width = Math.min(64, Math.max(24, Number(req.query.width) || 48));
  const fmt = String(req.query.format || 'json');
  if (fmt === 'escpos') { res.type('application/octet-stream'); return res.send(receiptEscPos(d, width, String(req.query.encoding || 'cp437'), { openDrawer: req.query.drawer === '1' })); }
  if (fmt === 'text') return res.type('text/plain; charset=utf-8').send(receiptText(d, width));
  if (fmt === 'pdf') { res.type('application/pdf'); res.setHeader('Content-Disposition', `inline; filename="invoice-${d.billNo}.pdf"`); return res.send(await invoicePdf(d)); }
  const assets = await restaurantPublicAssets(req.restaurant);
  res.json({ data: { ...d, logoUrl: assets.logoUrl, text: receiptText(d, width) } });
}));
opsRouter.get('/printers/test-page', requirePerm('pos.use'), ah(async (req, res) => {
  const width = Math.min(64, Math.max(24, Number(req.query.width) || 48));
  const branding = await getBranding();
  const d: ReceiptData = { restaurant: { name: req.restaurant.name, address: req.restaurant.address, phone: req.restaurant.contact_phone }, billNo: 'TEST', dateText: new Date().toISOString(), orderType: 'test', currency: req.restaurant.currency,
    lines: [{ name: 'Printer test line', qty: 1, unit: '1', total: '1' }, { name: 'ÄÖÜ é ñ — encoding check', qty: 2, unit: '0.5', total: '1' }], subtotal: '2', discount: '0', taxes: [], deliveryCharge: '0', total: '2', paid: '2', balance: '0', payments: [{ method: 'test', amount: '2' }], footer: `Width ${width} chars`, poweredBy: branding.softwareName };
  if (req.query.format === 'escpos') { res.type('application/octet-stream'); return res.send(receiptEscPos(d, width, String(req.query.encoding || 'cp437'))); }
  res.type('text/plain; charset=utf-8').send(receiptText(d, width));
}));

/* --------------------------------- POS --------------------------------- */
opsRouter.post('/pos/sales', requirePerm('pos.use'), ah(async (req, res) => {
  const b = parse(z.object({
    idempotencyKey: z.string().min(8).max(80), orderType: z.enum(['dine_in', 'takeaway', 'delivery', 'pickup']), tableId: zId.nullable().optional(), customerId: zId.nullable().optional(), customerName: z.string().max(190).nullable().optional(),
    lines: z.array(zLine).min(1).max(100), notes: z.string().max(500).nullable().optional(), hold: z.boolean().optional(), billId: zId.nullable().optional(),
    discount: z.object({ type: z.enum(['percent', 'fixed']), value: zPosMoney }).nullable().optional(), couponCode: z.string().max(40).nullable().optional(), taxSelection: z.array(zId).nullable().optional(),
    payments: z.array(z.object({ methodType: z.enum(['cash', 'bank', 'wallet', 'card', 'other']), methodId: zId.nullable().optional(), amount: zPosMoney, reference: z.string().max(190).nullable().optional(), splitLabel: z.string().max(80).nullable().optional() })).max(20).default([]),
    cashTendered: zPosMoney.nullable().optional(),
  }), req.body);
  if ((b.discount || b.couponCode || b.lines.some((l) => l.complimentary)) && !hasPermission(req.user!.permissions, 'discounts.apply')) throw forbidden('Discounts require permission');
  const actor = actorFromReq(req);
  const key = `pos${req.user!.id}:${b.idempotencyKey}`;
  const existing = await one<any>('SELECT response FROM idempotency_keys WHERE restaurant_id=? AND scope=? AND idem_key=?', [req.restaurant.id, 'pos_sale', key]);
  if (existing?.response) return res.status(200).json({ data: j(existing.response, {}), duplicate: true });
  const shift = await one<any>('SELECT id FROM pos_shifts WHERE restaurant_id=? AND user_id=? AND closed_at IS NULL', [req.restaurant.id, req.user!.id]);
  const out = await tx(async (db) => {
    await exec('INSERT INTO idempotency_keys (restaurant_id, scope, idem_key) VALUES (?,?,?)', [req.restaurant.id, 'pos_sale', key], db);
    let billId = b.billId ?? null;
    if (!billId && b.tableId && b.orderType === 'dine_in') billId = (await one<any>("SELECT id FROM bills WHERE restaurant_id=? AND table_id=? AND status='open' ORDER BY id DESC LIMIT 1 FOR UPDATE", [req.restaurant.id, b.tableId], db))?.id ?? null;
    const o = await createOrder(db, { restaurant: req.restaurant, channel: 'pos', orderType: b.orderType, lines: b.lines, tableId: b.tableId, billId, customerId: b.customerId, customerName: b.customerName, notes: b.notes, hold: b.hold, branchId: req.user!.branchId, idempotencyKey: key, actor });
    const bid = o.order.bill_id;
    if (b.discount !== undefined || b.couponCode || b.taxSelection !== undefined) await setBillAdjustments(db, req.restaurant.id, bid, actor, { discount: b.discount, couponCode: b.couponCode, taxSelection: b.taxSelection });
    else if (!b.hold) await recomputeBill(db, req.restaurant.id, bid);
    let change = '0';
    if (!b.hold) {
      const bill = await one<any>('SELECT total, paid_total FROM bills WHERE id=?', [bid], db);
      const due = D(bill.total).minus(D(bill.paid_total));
      const payTotal = b.payments.reduce((s, p) => s.plus(D(p.amount)), D(0));
      if (payTotal.gt(due)) throw badRequest(`Payments (${payTotal.toFixed(2)}) exceed amount due (${due.toFixed(2)}). Record change separately with cash tendered.`);
      for (const [i, p] of b.payments.entries()) await recordStaffPayment(db, req.restaurant.id, bid, actor, { ...p, shiftId: shift?.id ?? null, idempotencyKey: `${key}:p${i}` });
      if (b.cashTendered) { const cashPart = b.payments.filter((p) => p.methodType === 'cash').reduce((s, p) => s.plus(D(p.amount)), D(0)); change = D(b.cashTendered).minus(cashPart).toFixed(4); if (D(change).lt(0)) throw badRequest('Cash tendered is less than the cash amount'); }
      const after = await one<any>('SELECT total, paid_total FROM bills WHERE id=?', [bid], db);
      if (D(after.paid_total).gte(D(after.total)) && D(after.total).gte(0) && b.payments.length) await closeBill(db, req.restaurant.id, bid, actor, {});
    }
    const bill = await one<any>('SELECT id, bill_no, status, payment_status, total, paid_total FROM bills WHERE id=?', [bid], db);
    const response = { orderId: o.order.id, orderNo: o.order.order_no, held: !!b.hold, bill, change };
    await exec('UPDATE idempotency_keys SET response=? WHERE restaurant_id=? AND scope=? AND idem_key=?', [JSON.stringify(response), req.restaurant.id, 'pos_sale', key], db);
    return response;
  });
  res.status(201).json({ data: out });
}));
/** Price preview (no writes): server-side prices, discount and taxes exactly as the sale would compute them. */
opsRouter.post('/pos/quote', requirePerm('pos.use', 'orders.create'), ah(async (req, res) => {
  const b = parse(z.object({ orderType: z.enum(['dine_in', 'takeaway', 'delivery', 'pickup']), lines: z.array(zLine).min(1).max(100), discount: z.object({ type: z.enum(['percent', 'fixed']), value: zPosMoney }).nullable().optional(), taxSelection: z.array(zId).nullable().optional() }), req.body);
  const { priceLines } = await import('../../services/orders.js');
  const { taxesForRestaurant } = await import('../../services/bills.js');
  const priced = await priceLines(pool, req.restaurant.id, b.lines, { channel: 'pos' });
  const taxes = await taxesForRestaurant(pool, req.restaurant.id);
  const calc = calculateBill({ currency: req.restaurant.currency, orderType: b.orderType, discount: b.discount ?? null,
    lines: priced.map((p, i) => ({ key: i, itemId: p.itemId, categoryId: p.categoryId, unitPrice: p.unitPrice, addonsTotal: p.addonsTotal, quantity: p.quantity, complimentary: p.complimentary })),
    taxes: taxes.map((t) => ({ id: t.id, name: t.name, calcType: t.calc_type, rate: t.rate, inclusive: !!t.inclusive, isLiability: !!t.is_liability, appliesTo: j(t.applies_to, null), orderTypes: j(t.order_types, null), selected: t.is_optional ? (b.taxSelection ? b.taxSelection.includes(t.id) : !!t.default_selected) : true })) });
  res.json({ data: { ...calc, optionalTaxes: taxes.filter((t) => t.is_optional).map((t) => ({ id: t.id, name: t.name, rate: t.rate, defaultSelected: !!t.default_selected })) } });
}));
opsRouter.get('/pos/held', requirePerm('pos.use'), ah(async (req, res) => {
  const rows = await q<any>("SELECT o.id, o.order_no, o.bill_id, o.customer_name, o.table_id, o.order_type, o.subtotal, o.created_at FROM orders o WHERE o.restaurant_id=? AND o.status='draft' AND o.is_held=1 ORDER BY o.id DESC", [req.restaurant.id]);
  const items = rows.length ? await q<any>('SELECT order_id, menu_item_id, variant_id, addons, quantity, notes, name, line_total FROM order_items WHERE order_id IN (?)', [rows.map((r) => r.id)]) : [];
  res.json({ data: rows.map((r) => ({ ...r, items: items.filter((i) => i.order_id === r.id).map((i) => ({ ...i, addons: j(i.addons, []) })) })) });
}));
/** Discard a held order (it was never sent to the kitchen). */
opsRouter.delete('/pos/held/:id', requirePerm('pos.use'), ah(async (req, res) => {
  await tx(async (db) => {
    const o = await one<any>("SELECT * FROM orders WHERE id=? AND restaurant_id=? AND status='draft' FOR UPDATE", [idParam(req), req.restaurant.id], db);
    if (!o) throw notFound('Held order');
    await exec("UPDATE orders SET status='cancelled', is_held=0, cancelled_at=NOW(3), rejection_reason='Held order discarded' WHERE id=?", [o.id], db);
    const others = await one<any>("SELECT COUNT(*) c FROM orders WHERE bill_id=? AND status<>'cancelled'", [o.bill_id], db);
    if (!Number(others.c)) await exec("UPDATE bills SET status='void', closed_at=NOW(3) WHERE id=? AND paid_total=0", [o.bill_id], db);
    await audit(actorFromReq(req), 'pos.held_discard', 'order', o.id, {}, db);
  });
  res.json({ ok: true });
}));
/** Resume: send a held order to the kitchen (accept) — payment can follow via /bills/:id/payments. */
opsRouter.post('/pos/held/:id/resume', requirePerm('pos.use'), ah(async (req, res) => {
  const o = await tx(async (db) => {
    const order = await transitionOrder(db, req.restaurant, idParam(req), 'accepted', actorFromReq(req));
    await recomputeBill(db, req.restaurant.id, order.bill_id);
    return order;
  });
  res.json({ data: { orderId: o.id, billId: o.bill_id } });
}));

opsRouter.get('/pos/shift', requirePerm('pos.use'), ah(async (req, res) => {
  const s = await one<any>('SELECT * FROM pos_shifts WHERE restaurant_id=? AND user_id=? AND closed_at IS NULL', [req.restaurant.id, req.user!.id]);
  if (!s) return res.json({ data: null });
  res.json({ data: { ...s, ...(await shiftTotals(req.restaurant.id, s)) } });
}));
async function shiftTotals(restaurantId: number, s: any) {
  const cashIn = await one<any>("SELECT COALESCE(SUM(amount),0) v FROM payments WHERE restaurant_id=? AND shift_id=? AND method_type='cash' AND status='cash_collected'", [restaurantId, s.id]);
  const other = await one<any>("SELECT COALESCE(SUM(amount),0) v FROM payments WHERE restaurant_id=? AND shift_id=? AND method_type<>'cash' AND status='approved'", [restaurantId, s.id]);
  const cashOut = await one<any>("SELECT COALESCE(SUM(amount),0) v FROM refunds WHERE restaurant_id=? AND shift_id=? AND method_type='cash'", [restaurantId, s.id]);
  const expected = D(s.opening_cash).plus(D(cashIn.v)).minus(D(cashOut.v));
  return { cashSales: cashIn.v, nonCashSales: other.v, cashRefunds: cashOut.v, expectedCash: expected.toFixed(4) };
}
opsRouter.post('/pos/shift/open', requirePerm('pos.use'), ah(async (req, res) => {
  const b = parse(z.object({ openingCash: zPosMoney }), req.body);
  if (await one('SELECT id FROM pos_shifts WHERE restaurant_id=? AND user_id=? AND closed_at IS NULL', [req.restaurant.id, req.user!.id])) throw conflict('You already have an open shift');
  const r = await exec('INSERT INTO pos_shifts (restaurant_id, branch_id, user_id, opening_cash) VALUES (?,?,?,?)', [req.restaurant.id, req.user!.branchId, req.user!.id, b.openingCash]);
  await audit(actorFromReq(req), 'pos.shift_open', 'pos_shift', r.insertId, b);
  res.status(201).json({ data: { id: r.insertId } });
}));
opsRouter.post('/pos/shift/close', requirePerm('pos.use'), ah(async (req, res) => {
  const b = parse(z.object({ countedCash: zPosMoney, notes: z.string().max(500).nullable().optional() }), req.body);
  const s = await one<any>('SELECT * FROM pos_shifts WHERE restaurant_id=? AND user_id=? AND closed_at IS NULL', [req.restaurant.id, req.user!.id]);
  if (!s) throw notFound('Open shift');
  const t = await shiftTotals(req.restaurant.id, s);
  const diff = D(b.countedCash).minus(D(t.expectedCash));
  await exec('UPDATE pos_shifts SET closed_at=NOW(3), expected_cash=?, counted_cash=?, difference=?, notes=? WHERE id=?', [t.expectedCash, b.countedCash, diff.toFixed(4), b.notes ?? null, s.id]);
  await audit(actorFromReq(req), 'pos.shift_close', 'pos_shift', s.id, { ...t, counted: b.countedCash, difference: diff.toFixed(4) });
  if (!diff.isZero()) await notify({ restaurantId: req.restaurant.id, type: 'cash_difference', permission: 'reports.financial', title: `Cash difference on shift #${s.id}`, body: `${req.user!.name}: expected ${D(t.expectedCash).toFixed(2)}, counted ${D(b.countedCash).toFixed(2)} (${diff.toFixed(2)}). Record as a billing discrepancy if needed.` });
  res.json({ data: { ...t, countedCash: b.countedCash, difference: diff.toFixed(4) } });
}));

/* --------------------------------- Billing discrepancies --------------------------------- */
opsRouter.get('/discrepancies', requirePerm('discrepancy.manage'), ah(async (req, res) => {
  res.json({ data: await q('SELECT d.*, t.name table_name, u.name responsible_name FROM billing_discrepancies d LEFT JOIN dining_tables t ON t.id=d.table_id LEFT JOIN users u ON u.id=d.responsible_user_id WHERE d.restaurant_id=? ORDER BY d.id DESC LIMIT 500', [req.restaurant.id]) });
}));
opsRouter.post('/discrepancies', requirePerm('discrepancy.manage'), ah(async (req, res) => {
  const b = parse(z.object({
    customerName: z.string().max(190).nullable().optional(), tableId: zId.nullable().optional(), orderId: zId.nullable().optional(), billId: zId.nullable().optional(), amount: zPosMoney,
    description: z.string().max(1000).nullable().optional(), reason: z.string().min(2).max(300), responsibleUserId: zId.nullable().optional(), occurredAt: z.string().datetime(), classification: z.enum(['loss', 'neutral']),
  }), req.body);
  for (const [col, table] of [['tableId', 'dining_tables'], ['orderId', 'orders'], ['billId', 'bills'], ['responsibleUserId', 'users']] as const) {
    const v = (b as any)[col];
    if (v && !(await one(`SELECT id FROM ${table} WHERE id=? AND restaurant_id=?`, [v, req.restaurant.id]))) throw badRequest(`Invalid ${col}`);
  }
  const id = await tx(async (db) => {
    const r = await exec('INSERT INTO billing_discrepancies (restaurant_id, customer_name, table_id, order_id, bill_id, amount, description, reason, responsible_user_id, occurred_at, classification, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [req.restaurant.id, b.customerName ?? null, b.tableId ?? null, b.orderId ?? null, b.billId ?? null, b.amount, b.description ?? null, b.reason, b.responsibleUserId ?? null, new Date(b.occurredAt), b.classification, req.user!.id], db);
    // shortfall from cash on hand (cash not matching sales); classified loss → P&L, neutral → suspense
    await postTxn(db, { restaurantId: req.restaurant.id, refType: 'discrepancy', refId: r.insertId, memo: `Billing discrepancy: ${b.reason}`,
      legs: [{ account: b.classification === 'loss' ? 'billing_loss' : 'discrepancy_suspense', debit: b.amount }, { account: 'cash', credit: b.amount }] });
    await audit(actorFromReq(req), 'discrepancy.create', 'billing_discrepancy', r.insertId, b, db);
    return r.insertId;
  });
  res.status(201).json({ data: { id } });
}));
opsRouter.post('/discrepancies/:id/classify', requirePerm('discrepancy.manage'), ah(async (req, res) => {
  const b = parse(z.object({ classification: z.enum(['loss', 'neutral']), note: z.string().max(300).optional() }), req.body);
  await tx(async (db) => {
    const d = await one<any>('SELECT * FROM billing_discrepancies WHERE id=? AND restaurant_id=? FOR UPDATE', [idParam(req), req.restaurant.id], db);
    if (!d) throw notFound('Discrepancy');
    if (d.classification === b.classification) return;
    const from = d.classification === 'loss' ? 'billing_loss' : 'discrepancy_suspense';
    const to = b.classification === 'loss' ? 'billing_loss' : 'discrepancy_suspense';
    await postTxn(db, { restaurantId: req.restaurant.id, refType: 'discrepancy_reclass', refId: d.id, memo: `Reclassified ${d.classification} → ${b.classification}${b.note ? ': ' + b.note : ''}`, legs: [{ account: to, debit: d.amount }, { account: from, credit: d.amount }] });
    await exec('UPDATE billing_discrepancies SET classification=? WHERE id=?', [b.classification, d.id], db);
    await audit(actorFromReq(req), 'discrepancy.reclassify', 'billing_discrepancy', d.id, { from: d.classification, to: b.classification, note: b.note }, db);
  });
  res.json({ ok: true });
}));
