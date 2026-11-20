import { exec, j, one, q, toJson, type Db } from '../lib/db.js';
import { D, Decimal, roundMoney } from '../lib/money.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { uuid } from '../lib/crypto.js';
import { calculateBill, type CalcTax } from './billCalc.js';
import { cashAccount, postTxn } from './ledger.js';
import { emit, rooms } from '../realtime/bus.js';
import { notify } from './notify.js';
import { audit, type Actor } from '../lib/audit.js';
import { restaurantSettings } from './settings.js';
import { reverseForItems } from './inventory.js';

export function localDateKey(tz: string, d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz || 'UTC', year: '2-digit', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${g('year')}${g('month')}${g('day')}`;
}

export async function nextCounter(db: Db, restaurantId: number, key: string) {
  await exec('INSERT INTO order_counters (restaurant_id, counter_key, `last_value`) VALUES (?,?,LAST_INSERT_ID(1)) ON DUPLICATE KEY UPDATE `last_value`=LAST_INSERT_ID(`last_value`+1)', [restaurantId, key], db);
  const r = await one<{ v: number }>('SELECT LAST_INSERT_ID() v', [], db);
  return Number(r!.v);
}

export async function createBill(db: Db, restaurant: any, p: {
  branchId?: number | null; tableId?: number | null; customerId?: number | null; customerName?: string | null;
  orderType: 'dine_in' | 'takeaway' | 'delivery' | 'pickup'; channel: 'qr' | 'online' | 'pos' | 'waiter'; deliveryCharge?: string;
}) {
  const day = localDateKey(restaurant.timezone);
  const n = await nextCounter(db, restaurant.id, `b:${day}`);
  const billNo = `B${day}-${String(n).padStart(4, '0')}`;
  const res = await exec(
    `INSERT INTO bills (public_id, restaurant_id, branch_id, bill_no, table_id, customer_id, customer_name, order_type, channel, currency, delivery_charge)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [uuid(), restaurant.id, p.branchId ?? null, billNo, p.tableId ?? null, p.customerId ?? null, p.customerName ?? null, p.orderType, p.channel, restaurant.currency, D(p.deliveryCharge ?? 0).toFixed(4)], db);
  return res.insertId;
}

export async function taxesForRestaurant(db: Db, restaurantId: number) {
  return q<any>(
    `SELECT * FROM taxes WHERE restaurant_id=? AND enabled=1 AND (effective_from IS NULL OR effective_from<=CURDATE()) AND (effective_to IS NULL OR effective_to>=CURDATE()) ORDER BY sort_order, id`,
    [restaurantId], db);
}

/** Recalculate a bill from its live order lines. Must run inside the caller's transaction. */
export async function recomputeBill(db: Db, restaurantId: number, billId: number) {
  const bill = await one<any>('SELECT * FROM bills WHERE id=? AND restaurant_id=? FOR UPDATE', [billId, restaurantId], db);
  if (!bill) throw notFound('Bill');
  if (bill.status !== 'open') return bill;
  const lines = await q<any>(
    `SELECT oi.* FROM order_items oi JOIN orders o ON o.id=oi.order_id
      WHERE o.bill_id=? AND o.restaurant_id=? AND o.status NOT IN ('draft','rejected','cancelled') AND oi.status<>'cancelled'`,
    [billId, restaurantId], db);
  const taxes = await taxesForRestaurant(db, restaurantId);
  const selection = j<number[] | null>(bill.tax_selection, null);
  const calcTaxes: CalcTax[] = taxes.map((t) => ({
    id: t.id, name: t.name, calcType: t.calc_type, rate: t.rate, inclusive: !!t.inclusive, isLiability: !!t.is_liability,
    appliesTo: j(t.applies_to, null), orderTypes: j(t.order_types, null),
    selected: t.is_optional ? (selection ? selection.includes(t.id) : !!t.default_selected) : true,
  }));
  const calc = calculateBill({
    currency: bill.currency, orderType: bill.order_type,
    lines: lines.map((l) => ({ key: l.id, itemId: l.menu_item_id, categoryId: l.category_id, unitPrice: l.unit_price, addonsTotal: l.addons_total, quantity: l.quantity, complimentary: !!l.is_complimentary })),
    taxes: calcTaxes, discount: j(bill.discount, null), deliveryCharge: bill.delivery_charge,
  });
  await exec('DELETE FROM bill_taxes WHERE bill_id=? AND restaurant_id=?', [billId, restaurantId], db);
  if (calc.taxes.length) {
    await exec('INSERT INTO bill_taxes (restaurant_id, bill_id, tax_id, name, rate, calc_type, inclusive, is_liability, taxable_amount, amount) VALUES ?',
      [calc.taxes.map((t) => [restaurantId, billId, t.taxId, t.name, t.rate, t.calcType, t.inclusive ? 1 : 0, t.isLiability ? 1 : 0, t.taxableAmount, t.amount])], db);
  }
  await exec('UPDATE bills SET subtotal=?, discount_total=?, tax_total=?, inclusive_tax_total=?, total=? WHERE id=?',
    [calc.subtotal, calc.discountTotal, calc.taxTotal, calc.inclusiveTaxTotal, calc.total, billId], db);
  await refreshPaymentStatus(db, restaurantId, billId);
  return { ...bill, ...calc };
}

export async function refreshPaymentStatus(db: Db, restaurantId: number, billId: number) {
  const bill = await one<any>('SELECT total, refunded_total FROM bills WHERE id=? AND restaurant_id=?', [billId, restaurantId], db);
  if (!bill) return;
  const pays = await q<any>('SELECT status, amount FROM payments WHERE bill_id=? AND restaurant_id=?', [billId, restaurantId], db);
  const paid = pays.filter((p) => p.status === 'approved' || p.status === 'cash_collected').reduce((s, p) => s.plus(D(p.amount)), D(0));
  const refunded = D(bill.refunded_total);
  const total = D(bill.total);
  let status: string;
  if (refunded.gt(0)) status = refunded.gte(paid) ? 'refunded' : 'partially_refunded';
  else if (paid.gte(total) && total.gt(0)) status = 'paid';
  else if (pays.some((p) => p.status === 'under_review' || p.status === 'submitted')) status = 'under_review';
  else if (pays.some((p) => p.status === 'cash_requested')) status = 'cash_requested';
  else if (paid.gt(0)) status = 'partially_paid';
  else status = 'unpaid';
  await exec('UPDATE bills SET paid_total=?, payment_status=? WHERE id=?', [paid.toFixed(4), status, billId], db);
  return { paid, status };
}

export async function billView(db: Db, restaurantId: number, billId: number, opts: { includeProofs?: boolean } = {}) {
  const bill = await one<any>('SELECT * FROM bills WHERE id=? AND restaurant_id=?', [billId, restaurantId], db);
  if (!bill) throw notFound('Bill');
  const orders = await q<any>('SELECT id, public_id, order_no, status, is_addition, created_at, prep_estimate_minutes, accepted_at, ready_at, editable_until, customer_name FROM orders WHERE bill_id=? AND restaurant_id=? ORDER BY id', [billId, restaurantId], db);
  const items = orders.length ? await q<any>('SELECT id, order_id, menu_item_id, name, variant_id, variant_name, addons, unit_price, addons_total, quantity, line_total, notes, status, is_complimentary FROM order_items WHERE order_id IN (?) ORDER BY id', [orders.map((o) => o.id)], db) : [];
  const taxes = await q<any>('SELECT tax_id, name, rate, calc_type, inclusive, amount, taxable_amount FROM bill_taxes WHERE bill_id=? AND restaurant_id=?', [billId, restaurantId], db);
  const payments = await q<any>(
    `SELECT p.id, p.method_type, p.method_id, p.amount, p.status, p.rejection_reason, p.reference, p.split_label, p.created_at, p.approved_at, f.public_id proof_public_id
       FROM payments p LEFT JOIN files f ON f.id=p.proof_file_id WHERE p.bill_id=? AND p.restaurant_id=? ORDER BY p.id`, [billId, restaurantId], db);
  const refunds = await q<any>('SELECT id, amount, reason, method_type, created_at FROM refunds WHERE bill_id=? AND restaurant_id=?', [billId, restaurantId], db);
  return {
    ...bill,
    tax_selection: j(bill.tax_selection, null), discount: j(bill.discount, null),
    balance_due: D(bill.total).minus(D(bill.paid_total)).plus(D(bill.refunded_total)).toFixed(4),
    orders: orders.map((o) => ({ ...o, items: items.filter((i) => i.order_id === o.id).map((i) => ({ ...i, addons: j(i.addons, []) })) })),
    taxes,
    payments: payments.map((p) => ({ ...p, proof_public_id: opts.includeProofs ? p.proof_public_id : undefined, has_proof: !!p.proof_public_id })),
    refunds,
  };
}

function broadcastBill(restaurantId: number, bill: any, sessionId?: number | null) {
  emit(rooms.staffPerm(restaurantId, 'billing.view'), 'bill:updated', { billId: bill.id, paymentStatus: bill.payment_status, status: bill.status });
  if (sessionId) emit(rooms.session(sessionId), 'bill:updated', { billId: bill.id });
}

async function sessionForBill(db: Db, restaurantId: number, billId: number) {
  const s = await one<any>('SELECT id FROM customer_sessions WHERE bill_id=? AND restaurant_id=? ORDER BY id DESC LIMIT 1', [billId, restaurantId], db);
  return s?.id ?? null;
}

/** Customer or staff submits a manual (bank/wallet) payment with screenshot. Never auto-verified. */
export async function submitManualPayment(db: Db, restaurantId: number, billId: number, p: {
  methodId: number; amount: string; proofFileId: number | null; reference?: string | null; sessionId?: number | null; userId?: number | null; idempotencyKey?: string | null; splitLabel?: string | null;
}) {
  const bill = await one<any>('SELECT * FROM bills WHERE id=? AND restaurant_id=? FOR UPDATE', [billId, restaurantId], db);
  if (!bill) throw notFound('Bill');
  if (bill.status === 'void') throw conflict('This bill was voided');
  const method = await one<any>('SELECT * FROM payment_methods WHERE id=? AND restaurant_id=? AND enabled=1', [p.methodId, restaurantId], db);
  if (!method) throw badRequest('Payment method not available');
  const amount = D(p.amount);
  if (amount.lte(0)) throw badRequest('Amount must be positive');
  if (p.idempotencyKey) {
    const dup = await one<any>('SELECT id FROM payments WHERE restaurant_id=? AND idempotency_key=?', [restaurantId, p.idempotencyKey], db);
    if (dup) return dup.id as number;
  }
  const res = await exec(
    `INSERT INTO payments (restaurant_id, bill_id, method_id, method_type, amount, status, proof_file_id, reference, submitted_by_session_id, recorded_by, idempotency_key, split_label)
     VALUES (?,?,?,?,?,'under_review',?,?,?,?,?,?)`,
    [restaurantId, billId, method.id, method.type === 'cash' ? 'cash' : method.type, amount.toFixed(4), p.proofFileId, p.reference ?? null, p.sessionId ?? null, p.userId ?? null, p.idempotencyKey ?? null, p.splitLabel ?? null], db);
  await refreshPaymentStatus(db, restaurantId, billId);
  await notify({ restaurantId, type: 'payment_submitted', permission: 'payments.approve', title: `Payment proof submitted — bill ${bill.bill_no}`, body: `Amount ${amount.toFixed(2)} ${bill.currency} via ${method.label}. Review required.`, data: { billId, paymentId: res.insertId } }, db);
  broadcastBill(restaurantId, { ...bill, payment_status: 'under_review' }, p.sessionId ?? (await sessionForBill(db, restaurantId, billId)));
  return res.insertId;
}

export async function requestCash(db: Db, restaurantId: number, billId: number, sessionId: number | null, amount?: string) {
  const bill = await one<any>('SELECT * FROM bills WHERE id=? AND restaurant_id=? FOR UPDATE', [billId, restaurantId], db);
  if (!bill) throw notFound('Bill');
  const existing = await one<any>("SELECT id FROM payments WHERE bill_id=? AND status='cash_requested'", [billId], db);
  if (existing) return existing.id as number;
  const due = D(bill.total).minus(D(bill.paid_total));
  const amt = amount ? D(amount) : due;
  if (amt.lte(0)) throw badRequest('Nothing to pay');
  const res = await exec("INSERT INTO payments (restaurant_id, bill_id, method_type, amount, status, submitted_by_session_id) VALUES (?,?,'cash',?,'cash_requested',?)", [restaurantId, billId, amt.toFixed(4), sessionId], db);
  await exec("INSERT INTO support_requests (restaurant_id, session_id, table_id, type, message) VALUES (?,?,?,'cash_collection',?)", [restaurantId, sessionId, bill.table_id, `Collect ${amt.toFixed(2)} ${bill.currency} for bill ${bill.bill_no}`], db);
  await refreshPaymentStatus(db, restaurantId, billId);
  await notify({ restaurantId, type: 'cash_requested', permission: 'payments.approve', title: `Cash collection requested — bill ${bill.bill_no}`, body: `Please collect ${amt.toFixed(2)} ${bill.currency}.`, data: { billId, tableId: bill.table_id } }, db);
  emit(rooms.staffPerm(restaurantId, 'support.handle'), 'support:new', { type: 'cash_collection', billId, tableId: bill.table_id });
  broadcastBill(restaurantId, bill, sessionId);
  return res.insertId;
}

async function postPaymentLedger(db: Db, restaurantId: number, branchId: number | null, payment: any) {
  const amount = D(payment.amount);
  let fee = D(0);
  if (payment.method_id) {
    const m = await one<any>('SELECT fee_percent FROM payment_methods WHERE id=?', [payment.method_id], db);
    if (m && D(m.fee_percent).gt(0)) fee = amount.times(D(m.fee_percent)).div(100).toDecimalPlaces(4);
  }
  if (fee.gt(0)) await exec('UPDATE payments SET fee_amount=? WHERE id=?', [fee.toFixed(4), payment.id], db);
  await postTxn(db, {
    restaurantId, branchId, refType: 'payment', refId: payment.id, memo: `Payment #${payment.id} (${payment.method_type})`,
    legs: [
      { account: cashAccount(payment.method_type), debit: amount.minus(fee).toFixed(4) },
      { account: 'payment_fees', debit: fee.toFixed(4) },
      { account: 'receivable', credit: amount.toFixed(4) },
    ],
  });
}

/** Authorised staff approves a submitted payment, or confirms cash collection. */
export async function approvePayment(db: Db, restaurantId: number, paymentId: number, actor: Actor, opts: { amount?: string; shiftId?: number | null } = {}) {
  const p = await one<any>('SELECT * FROM payments WHERE id=? AND restaurant_id=? FOR UPDATE', [paymentId, restaurantId], db);
  if (!p) throw notFound('Payment');
  if (!['submitted', 'under_review', 'cash_requested'].includes(p.status)) throw conflict(`Payment is already ${p.status}`);
  const bill = await one<any>('SELECT * FROM bills WHERE id=? FOR UPDATE', [p.bill_id], db);
  const newStatus = p.status === 'cash_requested' ? 'cash_collected' : 'approved';
  if (opts.amount) {
    if (D(opts.amount).lte(0)) throw badRequest('Amount must be positive');
    p.amount = D(opts.amount).toFixed(4);
  }
  await exec('UPDATE payments SET status=?, amount=?, approved_by=?, approved_at=NOW(3), shift_id=COALESCE(shift_id, ?) WHERE id=?', [newStatus, p.amount, actor.userId, opts.shiftId ?? null, p.id], db);
  await postPaymentLedger(db, restaurantId, bill.branch_id, p);
  await exec("UPDATE support_requests SET status='resolved', resolved_at=NOW(3), handled_by=? WHERE restaurant_id=? AND type='cash_collection' AND status<>'resolved' AND message LIKE ?", [actor.userId, restaurantId, `%bill ${bill.bill_no}`], db);
  const st = await refreshPaymentStatus(db, restaurantId, p.bill_id);
  await audit(actor, 'payment.approve', 'payment', p.id, { amount: p.amount, billId: p.bill_id, status: newStatus }, db);
  const sid = p.submitted_by_session_id ?? (await sessionForBill(db, restaurantId, p.bill_id));
  broadcastBill(restaurantId, { ...bill, payment_status: st?.status }, sid);
  if (st?.status === 'paid' && bill.status === 'open') await closeBill(db, restaurantId, p.bill_id, actor, {});
  return { status: newStatus, billPaymentStatus: st?.status };
}

export async function rejectPayment(db: Db, restaurantId: number, paymentId: number, reason: string, actor: Actor) {
  const p = await one<any>('SELECT * FROM payments WHERE id=? AND restaurant_id=? FOR UPDATE', [paymentId, restaurantId], db);
  if (!p) throw notFound('Payment');
  if (!['submitted', 'under_review', 'cash_requested'].includes(p.status)) throw conflict(`Payment is already ${p.status}`);
  await exec("UPDATE payments SET status='rejected', rejection_reason=?, approved_by=?, approved_at=NOW(3) WHERE id=?", [reason, actor.userId, p.id], db);
  const st = await refreshPaymentStatus(db, restaurantId, p.bill_id);
  await audit(actor, 'payment.reject', 'payment', p.id, { reason }, db);
  const sid = p.submitted_by_session_id ?? (await sessionForBill(db, restaurantId, p.bill_id));
  broadcastBill(restaurantId, { id: p.bill_id, payment_status: st?.status, status: 'open' }, sid);
  if (sid) emit(rooms.session(sid), 'payment:rejected', { paymentId: p.id, reason });
}

/** Staff-recorded payment (POS / counter): immediately approved because an authorised user records it. */
export async function recordStaffPayment(db: Db, restaurantId: number, billId: number, actor: Actor, p: {
  methodType: 'cash' | 'bank' | 'wallet' | 'card' | 'other'; methodId?: number | null; amount: string; reference?: string | null; splitLabel?: string | null; shiftId?: number | null; idempotencyKey?: string | null;
}) {
  const bill = await one<any>('SELECT * FROM bills WHERE id=? AND restaurant_id=? FOR UPDATE', [billId, restaurantId], db);
  if (!bill) throw notFound('Bill');
  if (bill.status !== 'open') throw conflict('Bill is not open');
  if (p.methodId) {
    const m = await one('SELECT id FROM payment_methods WHERE id=? AND restaurant_id=?', [p.methodId, restaurantId], db);
    if (!m) throw badRequest('Unknown payment method');
  }
  if (p.idempotencyKey) {
    const dup = await one<any>('SELECT id FROM payments WHERE restaurant_id=? AND idempotency_key=?', [restaurantId, p.idempotencyKey], db);
    if (dup) return dup.id as number;
  }
  const amount = D(p.amount);
  if (amount.lte(0)) throw badRequest('Amount must be positive');
  const status = p.methodType === 'cash' ? 'cash_collected' : 'approved';
  const res = await exec(
    'INSERT INTO payments (restaurant_id, bill_id, method_id, method_type, amount, status, reference, recorded_by, approved_by, approved_at, shift_id, idempotency_key, split_label) VALUES (?,?,?,?,?,?,?,?,?,NOW(3),?,?,?)',
    [restaurantId, billId, p.methodId ?? null, p.methodType, amount.toFixed(4), status, p.reference ?? null, actor.userId, actor.userId, p.shiftId ?? null, p.idempotencyKey ?? null, p.splitLabel ?? null], db);
  await postPaymentLedger(db, restaurantId, bill.branch_id, { id: res.insertId, amount: amount.toFixed(4), method_type: p.methodType, method_id: p.methodId ?? null });
  await audit(actor, 'payment.record', 'payment', res.insertId, { billId, amount: amount.toFixed(4), methodType: p.methodType }, db);
  await refreshPaymentStatus(db, restaurantId, billId);
  return res.insertId;
}

/**
 * Close a bill: recognise revenue in the ledger, accrue loyalty, close the customer session.
 * If a balance is still due, `force` + `reason` is required and the shortfall is recorded as a neutral discrepancy.
 */
export async function closeBill(db: Db, restaurantId: number, billId: number, actor: Actor, opts: { force?: boolean; reason?: string }) {
  const bill = await one<any>('SELECT * FROM bills WHERE id=? AND restaurant_id=? FOR UPDATE', [billId, restaurantId], db);
  if (!bill) throw notFound('Bill');
  if (bill.status !== 'open') return bill;
  const unfinished = await one<any>("SELECT COUNT(*) c FROM orders WHERE bill_id=? AND status IN ('submitted','pending_approval') ", [billId], db);
  if (Number(unfinished.c) > 0 && !opts.force) throw conflict('Bill has orders still awaiting approval');
  const due = D(bill.total).minus(D(bill.paid_total));
  if (due.gt(0) && !opts.force) throw conflict(`Balance due: ${due.toFixed(2)} ${bill.currency}`, { balanceDue: due.toFixed(4) });
  if (due.gt(0) && !opts.reason) throw badRequest('A reason is required to close a bill with a balance due');

  const taxes = await q<any>('SELECT * FROM bill_taxes WHERE bill_id=?', [billId], db);
  const liability = taxes.filter((t) => t.is_liability).reduce((s, t) => s.plus(D(t.amount)), D(0));
  const nonLiability = taxes.filter((t) => !t.is_liability).reduce((s, t) => s.plus(D(t.amount)), D(0));
  const inclusive = taxes.filter((t) => t.inclusive).reduce((s, t) => s.plus(D(t.amount)), D(0));
  const exclusive = taxes.filter((t) => !t.inclusive).reduce((s, t) => s.plus(D(t.amount)), D(0));
  const sales = D(bill.subtotal).plus(exclusive).minus(inclusive).minus(exclusive); // = subtotal − inclusive taxes
  const total = D(bill.total), discount = D(bill.discount_total), delivery = D(bill.delivery_charge);

  if (!bill.revenue_posted && total.plus(discount).gt(0)) {
    await postTxn(db, {
      restaurantId, branchId: bill.branch_id, refType: 'bill', refId: billId, memo: `Bill ${bill.bill_no}`,
      legs: [
        { account: 'receivable', debit: total.toFixed(4) },
        { account: 'discounts', debit: discount.toFixed(4) },
        { account: 'sales', credit: sales.toFixed(4) },
        { account: 'tax_payable', credit: liability.toFixed(4) },
        { account: 'service_revenue', credit: nonLiability.toFixed(4) },
        { account: 'delivery_revenue', credit: delivery.toFixed(4) },
      ],
    });
  }
  if (due.gt(0)) {
    const dres = await exec(
      "INSERT INTO billing_discrepancies (restaurant_id, branch_id, customer_name, table_id, bill_id, amount, description, reason, occurred_at, classification, created_by) VALUES (?,?,?,?,?,?,?,?,NOW(3),'neutral',?)",
      [restaurantId, bill.branch_id, bill.customer_name, bill.table_id, billId, due.toFixed(4), `Bill ${bill.bill_no} closed with balance due`, opts.reason, actor.userId ?? 0], db);
    await postTxn(db, {
      restaurantId, branchId: bill.branch_id, refType: 'discrepancy', refId: dres.insertId, memo: `Unpaid balance on ${bill.bill_no}`,
      legs: [{ account: 'discrepancy_suspense', debit: due.toFixed(4) }, { account: 'receivable', credit: due.toFixed(4) }]
    });
  }
  await exec("UPDATE bills SET status='closed', closed_at=NOW(3), closed_by=?, revenue_posted=1 WHERE id=?", [actor.userId ?? null, billId], db);
  // Paying does not pull food off the kitchen screen: only already-served orders complete now;
  // orders still being prepared complete automatically when they are served (see transitionOrder).
  await exec("UPDATE orders SET status='completed', completed_at=NOW(3) WHERE bill_id=? AND status='served'", [billId], db);

  // stock deduction for trigger 'completed'
  const rest = await one<any>('SELECT * FROM restaurants WHERE id=?', [restaurantId], db);
  const settings = restaurantSettings(rest);
  if (settings.stockDeductionTrigger === 'completed') {
    const { deductForOrder } = await import('./inventory.js');
    const os = await q<any>("SELECT id FROM orders WHERE bill_id=? AND status='completed' AND stock_deducted=0", [billId], db);
    for (const o of os) await deductForOrder(db, restaurantId, o.id, actor.userId ?? null);
  }

  if (bill.customer_id) {
    await exec('UPDATE customers SET visit_count=visit_count+1, total_spent=total_spent+?, last_visit_at=NOW(3) WHERE id=? AND restaurant_id=?', [total.toFixed(4), bill.customer_id, restaurantId], db);
    if (settings.loyalty.enabled) {
      const pts = total.times(D(settings.loyalty.pointsPerCurrencyUnit)).floor().toNumber();
      if (pts > 0) {
        const ins = await exec("INSERT IGNORE INTO loyalty_transactions (restaurant_id, customer_id, points, reason, bill_id) VALUES (?,?,?,'earn',?)", [restaurantId, bill.customer_id, pts, billId], db);
        if (ins.affectedRows) await exec('UPDATE customers SET loyalty_points=loyalty_points+? WHERE id=?', [pts, bill.customer_id], db);
      }
    }
  }
  if (bill.coupon_id) await exec('UPDATE coupons SET used_count=used_count+1 WHERE id=? AND restaurant_id=?', [bill.coupon_id, restaurantId], db);
  const sid = await sessionForBill(db, restaurantId, billId);
  if (sid) await exec("UPDATE customer_sessions SET status='closed', closed_at=NOW(3) WHERE id=? AND status='active'", [sid], db);
  await audit(actor, 'bill.close', 'bill', billId, { total: bill.total, paid: bill.paid_total, forced: !!opts.force, reason: opts.reason }, db);
  broadcastBill(restaurantId, { ...bill, status: 'closed' }, sid);
  if (sid) emit(rooms.session(sid), 'session:closed', { billId });
  return { ...bill, status: 'closed' };
}

export async function refundBill(db: Db, restaurantId: number, billId: number, actor: Actor, p: { amount: string; reason: string; methodType: 'cash' | 'bank' | 'wallet' | 'card' | 'other'; restock?: boolean; shiftId?: number | null }) {
  const bill = await one<any>('SELECT * FROM bills WHERE id=? AND restaurant_id=? FOR UPDATE', [billId, restaurantId], db);
  if (!bill) throw notFound('Bill');
  if (bill.status !== 'closed') throw conflict('Only closed bills can be refunded; adjust or cancel items on open bills instead');
  const amount = roundMoney(p.amount, bill.currency);
  const refundable = D(bill.paid_total).minus(D(bill.refunded_total));
  if (amount.lte(0) || amount.gt(refundable)) throw badRequest(`Refund must be between 0 and ${refundable.toFixed(2)}`);
  const liabilityTax = await one<any>('SELECT COALESCE(SUM(amount),0) t FROM bill_taxes WHERE bill_id=? AND is_liability=1', [billId], db);
  const taxPortion = D(bill.total).gt(0) ? roundMoney(amount.times(D(liabilityTax.t)).div(D(bill.total)), bill.currency) : D(0);
  const res = await exec('INSERT INTO refunds (restaurant_id, bill_id, amount, tax_portion, method_type, reason, restocked, created_by, shift_id) VALUES (?,?,?,?,?,?,?,?,?)',
    [restaurantId, billId, amount.toFixed(4), taxPortion.toFixed(4), p.methodType, p.reason, p.restock ? 1 : 0, actor.userId, p.shiftId ?? null], db);
  await postTxn(db, {
    restaurantId, branchId: bill.branch_id, refType: 'refund', refId: res.insertId, memo: `Refund on ${bill.bill_no}: ${p.reason}`,
    legs: [{ account: 'refunds', debit: amount.minus(taxPortion).toFixed(4) }, { account: 'tax_payable', debit: taxPortion.toFixed(4) }, { account: cashAccount(p.methodType), credit: amount.toFixed(4) }]
  });
  await exec('UPDATE bills SET refunded_total=refunded_total+? WHERE id=?', [amount.toFixed(4), billId], db);
  if (p.restock) {
    const items = await q<any>('SELECT oi.id FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.bill_id=? AND oi.stock_deducted=1', [billId], db);
    await reverseForItems(db, restaurantId, items.map((i) => i.id), actor.userId ?? null, `Refund ${bill.bill_no}`);
  }
  await refreshPaymentStatus(db, restaurantId, billId);
  await audit(actor, 'bill.refund', 'bill', billId, { amount: amount.toFixed(4), reason: p.reason, restock: !!p.restock }, db);
  return res.insertId;
}

export async function setBillAdjustments(db: Db, restaurantId: number, billId: number, actor: Actor, p: { taxSelection?: number[] | null; discount?: { type: 'percent' | 'fixed'; value: string } | null; couponCode?: string | null }) {
  const bill = await one<any>('SELECT * FROM bills WHERE id=? AND restaurant_id=? FOR UPDATE', [billId, restaurantId], db);
  if (!bill) throw notFound('Bill');
  if (bill.status !== 'open') throw conflict('Bill is not open');
  const sets: string[] = []; const vals: unknown[] = [];
  if (p.taxSelection !== undefined) {
    if (p.taxSelection) {
      const valid = await q<any>('SELECT id FROM taxes WHERE restaurant_id=? AND id IN (?)', [restaurantId, p.taxSelection.length ? p.taxSelection : [0]], db);
      if (valid.length !== p.taxSelection.length) throw badRequest('Unknown tax in selection');
    }
    sets.push('tax_selection=?'); vals.push(toJson(p.taxSelection));
  }
  if (p.couponCode) {
    const c = await one<any>('SELECT * FROM coupons WHERE restaurant_id=? AND code=? AND active=1 AND (starts_at IS NULL OR starts_at<=NOW()) AND (ends_at IS NULL OR ends_at>=NOW()) AND (max_uses IS NULL OR used_count<max_uses)', [restaurantId, p.couponCode.toUpperCase()], db);
    if (!c) throw badRequest('Coupon is invalid or expired');
    if (D(bill.subtotal).lt(D(c.min_order))) throw badRequest(`Minimum order for this coupon is ${D(c.min_order).toFixed(2)}`);
    sets.push('discount=?', 'coupon_id=?'); vals.push(toJson({ type: c.discount_type, value: c.value, source: 'coupon', code: c.code }), c.id);
  } else if (p.discount !== undefined) {
    sets.push('discount=?', 'coupon_id=NULL'); vals.push(toJson(p.discount));
  }
  if (!sets.length) return;
  await exec(`UPDATE bills SET ${sets.join(',')} WHERE id=?`, [...vals, billId], db);
  await audit(actor, 'bill.adjust', 'bill', billId, p, db);
  return recomputeBill(db, restaurantId, billId);
}

export { Decimal };
