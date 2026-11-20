import { exec, j, one, q, toJson, type Db } from '../lib/db.js';
import { D } from '../lib/money.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { uuid } from '../lib/crypto.js';
import { audit, type Actor } from '../lib/audit.js';
import { emit, rooms } from '../realtime/bus.js';
import { createBill, localDateKey, nextCounter, recomputeBill } from './bills.js';
import { deductForOrder, reverseForItems } from './inventory.js';
import { notify } from './notify.js';
import { restaurantSettings } from './settings.js';

export type OrderStatus = 'draft' | 'submitted' | 'pending_approval' | 'accepted' | 'rejected' | 'preparing' | 'ready' | 'served' | 'completed' | 'cancelled';

export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  draft: ['submitted', 'pending_approval', 'accepted', 'cancelled'],
  submitted: ['pending_approval', 'accepted', 'rejected', 'cancelled'],
  pending_approval: ['accepted', 'rejected', 'cancelled'],
  accepted: ['preparing', 'ready', 'served', 'cancelled'],
  preparing: ['ready', 'served', 'cancelled'],
  ready: ['served', 'completed', 'cancelled'],
  served: ['completed'],
  completed: [],
  rejected: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus) {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export interface CartLine {
  itemId: number;
  variantId?: number | null;
  addonIds?: number[];
  quantity: number;
  notes?: string | null;
  complimentary?: boolean;
  complimentaryReason?: string | null;
}

/** Server-side pricing: never trust client prices. Rejects unavailable/disabled items. */
export async function priceLines(db: Db, restaurantId: number, lines: CartLine[], opts: { channel: string }) {
  if (!lines.length) throw badRequest('Order has no items');
  if (lines.length > 100) throw badRequest('Too many lines');
  const itemIds = [...new Set(lines.map((l) => l.itemId))];
  const items = await q<any>(
    `SELECT mi.*, mc.station_id cat_station, mc.prep_minutes cat_prep, mc.active cat_active FROM menu_items mi JOIN menu_categories mc ON mc.id=mi.category_id
      WHERE mi.restaurant_id=? AND mi.id IN (?)`, [restaurantId, itemIds], db);
  const variants = await q<any>('SELECT * FROM item_variants WHERE restaurant_id=? AND item_id IN (?) AND active=1', [restaurantId, itemIds], db);
  const addons = await q<any>('SELECT * FROM item_addons WHERE restaurant_id=? AND item_id IN (?) AND active=1', [restaurantId, itemIds], db);
  const unavailable: { itemId: number; name?: string; reason: string }[] = [];
  const priced = lines.map((l) => {
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 99) throw badRequest('Quantity must be between 1 and 99');
    const it = items.find((x) => x.id === l.itemId);
    if (!it) { unavailable.push({ itemId: l.itemId, reason: 'not_found' }); return null; }
    if (!it.active || !it.available || !it.cat_active) { unavailable.push({ itemId: it.id, name: it.name, reason: 'unavailable' }); return null; }
    if (opts.channel === 'online' && !it.online_enabled) { unavailable.push({ itemId: it.id, name: it.name, reason: 'not_online' }); return null; }
    const itemVariants = variants.filter((v) => v.item_id === it.id);
    let variant: any = null;
    if (l.variantId) {
      variant = itemVariants.find((v) => v.id === l.variantId);
      if (!variant) throw badRequest(`Variant not available for ${it.name}`);
    } else if (itemVariants.length) {
      variant = itemVariants.find((v) => v.is_default) || itemVariants[0];
    }
    const chosen = (l.addonIds || []).map((aid) => {
      const a = addons.find((x) => x.id === aid && x.item_id === it.id);
      if (!a) throw badRequest(`Add-on not available for ${it.name}`);
      return a;
    });
    const unit = D(it.price).plus(D(variant?.price_delta ?? 0));
    const addonsTotal = chosen.reduce((s, a) => s.plus(D(a.price)), D(0));
    const lineTotal = l.complimentary ? D(0) : unit.plus(addonsTotal).times(l.quantity);
    return {
      itemId: it.id, categoryId: it.category_id, name: it.name, variantId: variant?.id ?? null, variantName: variant?.name ?? null,
      addons: chosen.map((a) => ({ id: a.id, name: a.name, price: D(a.price).toFixed(4), ingredientId: a.ingredient_id, ingredientQty: a.ingredient_qty })),
      unitPrice: unit.toFixed(4), addonsTotal: addonsTotal.toFixed(4), quantity: l.quantity, lineTotal: lineTotal.toFixed(4),
      notes: l.notes?.slice(0, 500) ?? null, stationId: it.station_id ?? it.cat_station ?? null, prepMinutes: it.prep_minutes ?? it.cat_prep ?? null,
      complimentary: !!l.complimentary, complimentaryReason: l.complimentaryReason ?? null,
    };
  });
  if (unavailable.length) throw conflict('Some items are no longer available', { unavailable });
  return priced.filter(Boolean) as NonNullable<(typeof priced)[number]>[];
}

/** Estimate: longest line prep time + small queue factor from currently active tickets. */
export async function estimatePrep(db: Db, restaurantId: number, priced: { prepMinutes: number | null }[]) {
  const base = Math.max(10, ...priced.map((p) => p.prepMinutes || 0));
  const load = await one<any>("SELECT COUNT(*) c FROM kitchen_tickets WHERE restaurant_id=? AND status IN ('new','preparing')", [restaurantId], db);
  return base + Math.min(30, Math.floor(Number(load?.c || 0) / 3) * 2);
}

async function insertItems(db: Db, restaurantId: number, orderId: number, priced: Awaited<ReturnType<typeof priceLines>>) {
  const values = priced.map((p) => [restaurantId, orderId, p.itemId, p.categoryId, p.name, p.variantId, p.variantName, toJson(p.addons), p.unitPrice, p.addonsTotal, p.quantity, p.lineTotal, p.notes, p.stationId, p.prepMinutes, p.complimentary ? 1 : 0, p.complimentaryReason]);
  await exec('INSERT INTO order_items (restaurant_id, order_id, menu_item_id, category_id, name, variant_id, variant_name, addons, unit_price, addons_total, quantity, line_total, notes, station_id, prep_minutes, is_complimentary, complimentary_reason) VALUES ?', [values], db);
  const subtotal = priced.reduce((s, p) => s.plus(D(p.lineTotal)), D(0));
  await exec('UPDATE orders SET subtotal=? WHERE id=?', [subtotal.toFixed(4), orderId], db);
}

export async function logEvent(db: Db, restaurantId: number, orderId: number, event: string, data: unknown, actorType: 'customer' | 'staff' | 'system', actorId: number | null) {
  await exec('INSERT INTO order_events (restaurant_id, order_id, event, data, actor_type, actor_id) VALUES (?,?,?,?,?,?)', [restaurantId, orderId, event, toJson(data), actorType, actorId], db);
}

/** Route accepted order lines to kitchen stations: one ticket per station. */
async function createTickets(db: Db, restaurantId: number, orderId: number) {
  const items = await q<any>("SELECT id, station_id FROM order_items WHERE order_id=? AND ticket_id IS NULL AND status<>'cancelled'", [orderId], db);
  const byStation = new Map<number | null, number[]>();
  for (const i of items) {
    const k = i.station_id ?? null;
    byStation.set(k, [...(byStation.get(k) || []), i.id]);
  }
  for (const [stationId, ids] of byStation) {
    const t = await exec('INSERT INTO kitchen_tickets (restaurant_id, order_id, station_id) VALUES (?,?,?)', [restaurantId, orderId, stationId], db);
    await exec('UPDATE order_items SET ticket_id=? WHERE id IN (?)', [t.insertId, ids], db);
    emit([rooms.station(restaurantId, stationId), rooms.staffPerm(restaurantId, 'kitchen.view')], 'kds:ticket', { ticketId: t.insertId, orderId, stationId });
  }
}

export function broadcastOrder(order: any, event = 'order:updated') {
  const payload = { orderId: order.id, publicId: order.public_id, status: order.status, orderNo: order.order_no, tableId: order.table_id, channel: order.channel, billId: order.bill_id };
  emit(rooms.staffPerm(order.restaurant_id, 'orders.view'), event, payload);
  if (order.session_id) emit(rooms.session(order.session_id), event, payload);
}

export interface CreateOrderInput {
  restaurant: any;
  channel: 'qr' | 'online' | 'pos' | 'waiter';
  orderType: 'dine_in' | 'takeaway' | 'delivery' | 'pickup';
  lines: CartLine[];
  branchId?: number | null;
  tableId?: number | null;
  sessionId?: number | null;
  billId?: number | null;
  customerId?: number | null;
  customerName?: string | null;
  customerPhone?: string | null;
  deliveryAddress?: string | null;
  deliveryInstructions?: string | null;
  scheduledFor?: Date | null;
  notes?: string | null;
  idempotencyKey?: string | null;
  hold?: boolean;
  parentOrderId?: number | null;
  autoAccept?: boolean;
  actor: Actor;
}

export async function createOrder(db: Db, input: CreateOrderInput) {
  const r = input.restaurant;
  const settings = restaurantSettings(r);
  if (input.idempotencyKey) {
    const dup = await one<any>('SELECT * FROM orders WHERE restaurant_id=? AND idempotency_key=?', [r.id, input.idempotencyKey], db);
    if (dup) return { order: dup, duplicate: true };
  }
  const anyComp = input.lines.some((l) => l.complimentary);
  if (anyComp && input.actor.type === 'customer') throw forbidden('Complimentary items can only be added by staff');
  const priced = await priceLines(db, r.id, input.lines, { channel: input.channel });

  if (input.tableId) {
    const t = await one('SELECT id FROM dining_tables WHERE id=? AND restaurant_id=? AND active=1', [input.tableId, r.id], db);
    if (!t) throw badRequest('Table not available');
  }
  if (input.customerId) {
    const c = await one('SELECT id FROM customers WHERE id=? AND restaurant_id=?', [input.customerId, r.id], db);
    if (!c) throw badRequest('Unknown customer');
  }
  let billId = input.billId ?? null;
  if (billId) {
    const b = await one<any>('SELECT id, status FROM bills WHERE id=? AND restaurant_id=? FOR UPDATE', [billId, r.id], db);
    if (!b || b.status !== 'open') throw conflict('The bill is not open');
  } else {
    billId = await createBill(db, r, {
      branchId: input.branchId, tableId: input.tableId, customerId: input.customerId, customerName: input.customerName,
      orderType: input.orderType, channel: input.channel,
      deliveryCharge: input.orderType === 'delivery' ? settings.deliveryCharge : '0',
    });
    if (input.sessionId) await exec('UPDATE customer_sessions SET bill_id=? WHERE id=? AND restaurant_id=?', [billId, input.sessionId, r.id], db);
  }

  const day = localDateKey(r.timezone);
  const n = await nextCounter(db, r.id, `o:${day}`);
  const orderNo = `${day}-${String(n).padStart(3, '0')}`;
  const isCustomer = input.actor.type === 'customer';
  let status: OrderStatus;
  if (input.hold) status = 'draft';
  else if (input.autoAccept || !isCustomer) status = 'accepted';
  else status = settings.orderApprovalRequired ? 'pending_approval' : 'accepted';
  const prep = await estimatePrep(db, r.id, priced);
  const editableUntil = isCustomer && settings.editWindowMinutes > 0 ? new Date(Date.now() + settings.editWindowMinutes * 60000) : null;

  const res = await exec(
    `INSERT INTO orders (public_id, restaurant_id, branch_id, bill_id, parent_order_id, order_no, order_type, channel, table_id, customer_id, session_id, customer_name, customer_phone,
       delivery_address, delivery_instructions, scheduled_for, status, is_held, is_addition, notes, prep_estimate_minutes, editable_until, idempotency_key, created_by_user_id, submitted_at, accepted_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [uuid(), r.id, input.branchId ?? null, billId, input.parentOrderId ?? null, orderNo, input.orderType, input.channel, input.tableId ?? null, input.customerId ?? null, input.sessionId ?? null,
      input.customerName ?? null, input.customerPhone ?? null, input.deliveryAddress ?? null, input.deliveryInstructions ?? null, input.scheduledFor ?? null,
      status, input.hold ? 1 : 0, input.parentOrderId ? 1 : 0, input.notes?.slice(0, 1000) ?? null, prep, editableUntil, input.idempotencyKey ?? null,
      isCustomer ? null : input.actor.userId ?? null, status === 'draft' ? null : new Date(), status === 'accepted' ? new Date() : null], db);
  const orderId = res.insertId;
  await insertItems(db, r.id, orderId, priced);
  await logEvent(db, r.id, orderId, input.parentOrderId ? 'addition_created' : 'created', { lines: priced.map((p) => ({ name: p.name, qty: p.quantity, price: p.unitPrice, variant: p.variantName })), status }, isCustomer ? 'customer' : 'staff', input.actor.userId ?? null);
  if (status === 'accepted') await onAccepted(db, r, orderId, input.actor);
  if (status === 'pending_approval' && settings.stockDeductionTrigger === 'submitted') await deductForOrder(db, r.id, orderId, null);
  if (status !== 'draft') await recomputeBill(db, r.id, billId);
  const order = await one<any>('SELECT * FROM orders WHERE id=?', [orderId], db);
  if (status !== 'draft') {
    broadcastOrder(order, 'order:new');
    await notify({
      restaurantId: r.id, type: 'order_new', permission: 'orders.view',
      title: `${input.parentOrderId ? 'Additional items' : 'New order'} ${orderNo}${order.table_id ? ' — table' : ''}`,
      body: `${priced.length} line(s) via ${input.channel}${status === 'pending_approval' ? ' · approval required' : ''}`,
      data: { orderId, status },
    }, db);
  }
  return { order, duplicate: false };
}

async function onAccepted(db: Db, r: any, orderId: number, actor: Actor) {
  await createTickets(db, r.id, orderId);
  const s = restaurantSettings(r);
  if (s.stockDeductionTrigger === 'accepted' || s.stockDeductionTrigger === 'submitted') await deductForOrder(db, r.id, orderId, actor.userId ?? null);
}

/** Staff-driven status transitions with full audit and side effects. */
export async function transitionOrder(db: Db, restaurant: any, orderId: number, to: OrderStatus, actor: Actor, reason?: string) {
  const order = await one<any>('SELECT * FROM orders WHERE id=? AND restaurant_id=? FOR UPDATE', [orderId, restaurant.id], db);
  if (!order) throw notFound('Order');
  if (order.status === to) return order;
  if (!canTransition(order.status, to)) throw conflict(`Cannot change order from ${order.status} to ${to}`);
  if ((to === 'rejected' || to === 'cancelled') && !reason) throw badRequest('A reason is required');
  const tsCol: Partial<Record<OrderStatus, string>> = { accepted: 'accepted_at', ready: 'ready_at', served: 'served_at', completed: 'completed_at', cancelled: 'cancelled_at' };
  const sets = ['status=?']; const vals: unknown[] = [to];
  if (tsCol[to]) sets.push(`${tsCol[to]}=NOW(3)`);
  if (to === 'rejected' || to === 'cancelled') { sets.push('rejection_reason=?'); vals.push(reason); }
  if (to === 'served') { sets.push('served_by_user_id=?'); vals.push(actor.userId ?? null); }
  if (order.status === 'draft') { sets.push('is_held=0', 'submitted_at=NOW(3)'); }
  await exec(`UPDATE orders SET ${sets.join(',')} WHERE id=?`, [...vals, orderId], db);
  await logEvent(db, restaurant.id, orderId, `status:${to}`, { from: order.status, reason }, actor.type === 'customer' ? 'customer' : actor.type === 'system' ? 'system' : 'staff', actor.userId ?? null);

  const s = restaurantSettings(restaurant);
  if (to === 'accepted') await onAccepted(db, restaurant, orderId, actor);
  if (to === 'ready') {
    await exec("UPDATE order_items SET status='ready' WHERE order_id=? AND status IN ('pending','preparing')", [orderId], db);
    await exec("UPDATE kitchen_tickets SET status='ready', ready_at=NOW(3) WHERE order_id=? AND status IN ('new','preparing')", [orderId], db);
    if (s.stockDeductionTrigger === 'ready') await deductForOrder(db, restaurant.id, orderId, actor.userId ?? null);
    await notify({ restaurantId: restaurant.id, type: 'order_ready', permission: 'waiter.use', title: `Order ${order.order_no} is ready`, body: order.table_id ? 'Ready to serve' : 'Ready for pickup', data: { orderId, tableId: order.table_id } }, db);
  }
  if (to === 'served') {
    await exec("UPDATE order_items SET status='served' WHERE order_id=? AND status<>'cancelled'", [orderId], db);
    await exec("UPDATE kitchen_tickets SET status='served' WHERE order_id=? AND status<>'cancelled'", [orderId], db);
    const bill = await one<any>('SELECT status FROM bills WHERE id=?', [order.bill_id], db);
    if (bill?.status === 'closed') {
      await exec("UPDATE orders SET status='completed', completed_at=NOW(3) WHERE id=?", [orderId], db);
      await logEvent(db, restaurant.id, orderId, 'status:completed', { from: 'served', reason: 'bill already settled' }, 'system', null);
      if (s.stockDeductionTrigger === 'completed') await deductForOrder(db, restaurant.id, orderId, actor.userId ?? null);
    }
  }
  if (to === 'completed' && s.stockDeductionTrigger === 'completed') await deductForOrder(db, restaurant.id, orderId, actor.userId ?? null);
  if (to === 'rejected' || to === 'cancelled') {
    const items = await q<any>('SELECT id FROM order_items WHERE order_id=?', [orderId], db);
    await reverseForItems(db, restaurant.id, items.map((i) => i.id), actor.userId ?? null, `Order ${order.order_no} ${to}`);
    await exec("UPDATE order_items SET status='cancelled' WHERE order_id=?", [orderId], db);
    await exec("UPDATE kitchen_tickets SET status='cancelled' WHERE order_id=?", [orderId], db);
    await recomputeBill(db, restaurant.id, order.bill_id);
    await audit(actor, `order.${to}`, 'order', orderId, { reason, previous: order.status }, db);
  }
  const updated = await one<any>('SELECT * FROM orders WHERE id=?', [orderId], db);
  broadcastOrder(updated);
  return updated;
}

/** Customer edits a submitted order — only inside the configured window and before preparation starts. */
export async function customerEditOrder(db: Db, restaurant: any, sessionId: number, orderId: number, lines: CartLine[]) {
  const order = await one<any>('SELECT * FROM orders WHERE id=? AND restaurant_id=? AND session_id=? FOR UPDATE', [orderId, restaurant.id, sessionId], db);
  if (!order) throw notFound('Order');
  if (!order.editable_until || new Date(order.editable_until).getTime() < Date.now()) throw conflict('The editing window for this order has closed. You can still request additional items.', { code: 'EDIT_WINDOW_CLOSED' });
  if (!['pending_approval', 'submitted', 'accepted'].includes(order.status)) throw conflict('This order can no longer be edited');
  const started = await one<any>("SELECT COUNT(*) c FROM order_items WHERE order_id=? AND status IN ('preparing','ready','served')", [orderId], db);
  if (Number(started.c) > 0) throw conflict('The kitchen has started preparing this order');
  const priced = await priceLines(db, restaurant.id, lines, { channel: order.channel });
  const before = await q<any>('SELECT id, name, quantity, unit_price, variant_name FROM order_items WHERE order_id=?', [orderId], db);
  await reverseForItems(db, restaurant.id, before.map((b) => b.id), null, `Order ${order.order_no} edited`);
  await exec('DELETE FROM order_items WHERE order_id=?', [orderId], db);
  await exec('DELETE FROM kitchen_tickets WHERE order_id=?', [orderId], db);
  await insertItems(db, restaurant.id, orderId, priced);
  await logEvent(db, restaurant.id, orderId, 'customer_edit', { before: before.map((b) => ({ name: b.name, qty: b.quantity, price: b.unit_price, variant: b.variant_name })), after: priced.map((p) => ({ name: p.name, qty: p.quantity, price: p.unitPrice, variant: p.variantName })) }, 'customer', null);
  if (order.status === 'accepted') {
    await exec('UPDATE orders SET stock_deducted=0 WHERE id=?', [orderId], db);
    await onAccepted(db, restaurant, orderId, { type: 'customer' });
  }
  await recomputeBill(db, restaurant.id, order.bill_id);
  const updated = await one<any>('SELECT * FROM orders WHERE id=?', [orderId], db);
  broadcastOrder(updated, 'order:edited');
  return updated;
}

/** Kitchen updates one ticket; when every ticket of the order is ready, the order becomes ready. */
export async function updateTicket(db: Db, restaurant: any, ticketId: number, to: 'preparing' | 'ready', actor: Actor) {
  const t = await one<any>('SELECT * FROM kitchen_tickets WHERE id=? AND restaurant_id=? FOR UPDATE', [ticketId, restaurant.id], db);
  if (!t) throw notFound('Ticket');
  if (t.status === 'cancelled' || t.status === 'served') throw conflict(`Ticket is ${t.status}`);
  await exec(`UPDATE kitchen_tickets SET status=?, ${to === 'preparing' ? 'started_at=COALESCE(started_at,NOW(3))' : 'ready_at=NOW(3)'} WHERE id=?`, [to, ticketId], db);
  await exec("UPDATE order_items SET status=? WHERE ticket_id=? AND status<>'cancelled'", [to, ticketId], db);
  const order = await one<any>('SELECT * FROM orders WHERE id=? FOR UPDATE', [t.order_id], db);
  await logEvent(db, restaurant.id, order.id, `ticket:${to}`, { ticketId, stationId: t.station_id }, 'staff', actor.userId ?? null);
  if (to === 'preparing' && order.status === 'accepted') {
    await exec("UPDATE orders SET status='preparing' WHERE id=?", [order.id], db);
  }
  if (to === 'ready') {
    const pending = await one<any>("SELECT COUNT(*) c FROM kitchen_tickets WHERE order_id=? AND status IN ('new','preparing')", [order.id], db);
    if (Number(pending.c) === 0 && ['accepted', 'preparing'].includes(order.status)) {
      return { ticket: { ...t, status: to }, order: await transitionOrder(db, restaurant, order.id, 'ready', actor) };
    }
  }
  const updated = await one<any>('SELECT * FROM orders WHERE id=?', [order.id], db);
  broadcastOrder(updated);
  emit(rooms.station(restaurant.id, t.station_id), 'kds:ticket', { ticketId, status: to });
  return { ticket: { ...t, status: to }, order: updated };
}

export async function cancelOrderItem(db: Db, restaurant: any, itemId: number, reason: string, actor: Actor) {
  const it = await one<any>('SELECT oi.*, o.bill_id, o.order_no FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.id=? AND oi.restaurant_id=? FOR UPDATE', [itemId, restaurant.id], db);
  if (!it) throw notFound('Order item');
  if (it.status === 'cancelled') return;
  await reverseForItems(db, restaurant.id, [itemId], actor.userId ?? null, `Item cancelled: ${reason}`);
  await exec("UPDATE order_items SET status='cancelled' WHERE id=?", [itemId], db);
  await logEvent(db, restaurant.id, it.order_id, 'item_cancelled', { itemId, name: it.name, qty: it.quantity, reason }, 'staff', actor.userId ?? null);
  await audit(actor, 'order_item.cancel', 'order_item', itemId, { reason, order: it.order_no }, db);
  await recomputeBill(db, restaurant.id, it.bill_id);
  const o = await one<any>('SELECT * FROM orders WHERE id=?', [it.order_id], db);
  broadcastOrder(o);
}

export async function orderDetail(db: Db, restaurantId: number, orderId: number) {
  const o = await one<any>(`SELECT o.*, t.name table_name, t.table_number FROM orders o LEFT JOIN dining_tables t ON t.id=o.table_id WHERE o.id=? AND o.restaurant_id=?`, [orderId, restaurantId], db);
  if (!o) throw notFound('Order');
  const items = await q<any>('SELECT * FROM order_items WHERE order_id=? ORDER BY id', [orderId], db);
  const events = await q<any>('SELECT * FROM order_events WHERE order_id=? ORDER BY id', [orderId], db);
  return { ...o, items: items.map((i) => ({ ...i, addons: j(i.addons, []) })), events: events.map((e) => ({ ...e, data: j(e.data, null) })) };
}
