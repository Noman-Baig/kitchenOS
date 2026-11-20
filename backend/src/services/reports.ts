import { q, one, pool } from '../lib/db.js';
import { D } from '../lib/money.js';
import { badRequest } from '../lib/errors.js';
import { profitAndLoss } from './ledger.js';
import { recipeCost } from './inventory.js';
import type { ReportData } from './documents.js';

/* ------------------------- timezone-aware ranges ------------------------- */
export function tzOffsetMinutes(tz: string, at: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at);
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
  return Math.round((asUtc - at.getTime()) / 60000);
}
export function localMidnightUtc(tz: string, y: number, m: number, d: number) {
  let guess = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 2; i++) guess = Date.UTC(y, m - 1, d) - tzOffsetMinutes(tz, new Date(guess)) * 60000;
  return new Date(guess);
}
function localToday(tz: string) {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [y, m, d] = s.split('-').map(Number);
  return { y, m, d };
}
const addDays = (p: { y: number; m: number; d: number }, n: number) => { const t = new Date(Date.UTC(p.y, p.m - 1, p.d + n)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
const fmt = (p: { y: number; m: number; d: number }) => `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
const parseYmd = (s: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw badRequest('Dates must be YYYY-MM-DD'); const [y, m, d] = s.split('-').map(Number); return { y, m, d }; };

/** Converts a preset or local date range (restaurant timezone) to a half-open UTC range [from, to). */
export function localRangeToUtc(tz: string, preset = 'today', from?: string, to?: string) {
  const today = localToday(tz);
  let a = today, b = today;
  const dow = (new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay() + 6) % 7; // Monday=0
  switch (preset) {
    case 'today': break;
    case 'yesterday': a = b = addDays(today, -1); break;
    case 'this_week': a = addDays(today, -dow); break;
    case 'last_week': a = addDays(today, -dow - 7); b = addDays(today, -dow - 1); break;
    case 'this_month': a = { ...today, d: 1 }; break;
    case 'last_month': { const first = { ...today, d: 1 }; b = addDays(first, -1); a = { ...b, d: 1 }; break; }
    case 'this_year': a = { y: today.y, m: 1, d: 1 }; break;
    case 'last_30_days': a = addDays(today, -29); break;
    case 'custom': if (!from || !to) throw badRequest('Custom range requires from and to'); a = parseYmd(from); b = parseYmd(to); break;
    default: throw badRequest('Unknown date preset');
  }
  const fromUtc = localMidnightUtc(tz, a.y, a.m, a.d);
  const end = addDays(b, 1);
  const toUtc = localMidnightUtc(tz, end.y, end.m, end.d);
  if (toUtc <= fromUtc) throw badRequest('End date must be on or after start date');
  if (toUtc.getTime() - fromUtc.getTime() > 400 * 86400000 * 3) throw badRequest('Range too large');
  return { from: fromUtc, to: toUtc, label: fmt(a) === fmt(b) ? fmt(a) : `${fmt(a)} to ${fmt(b)}`, offsetMinutes: tzOffsetMinutes(tz, fromUtc), fromLocal: fmt(a), toLocal: fmt(b) };
}

export interface ReportFilters { branchId?: number | null; employeeId?: number | null; paymentMethod?: string | null; orderType?: string | null; channel?: string | null; categoryId?: number | null; itemId?: number | null; groupBy?: 'day' | 'week' | 'month' | 'year' }
export interface ReportCtx { restaurantId: number; currency: string; from: Date; to: Date; offsetMinutes: number; filters: ReportFilters }

export const REPORTS: Record<string, { title: string; financial?: boolean }> = {
  sales: { title: 'Sales report' }, revenue: { title: 'Revenue by channel' }, expenses: { title: 'Expense report', financial: true },
  pnl: { title: 'Profit & loss', financial: true }, cash: { title: 'Cash report', financial: true }, reconciliation: { title: 'Payment reconciliation', financial: true },
  tax: { title: 'Tax collection report', financial: true }, inventory: { title: 'Inventory report' }, valuation: { title: 'Stock valuation' }, purchases: { title: 'Purchase report' },
  food_cost: { title: 'Food cost report', financial: true }, recipe_profitability: { title: 'Recipe profitability', financial: true }, wastage: { title: 'Wastage report' },
  complimentary: { title: 'Complimentary items report' }, payroll: { title: 'Payroll report', financial: true }, employees: { title: 'Employee performance' },
  customers: { title: 'Customer history' }, loyalty: { title: 'Loyalty report' }, reservations: { title: 'Reservation report' },
  orders: { title: 'Order performance' }, kitchen: { title: 'Kitchen preparation performance' }, branches: { title: 'Branch comparison' },
};

function periodExpr(col: string, c: ReportCtx) {
  const local = `DATE_ADD(${col}, INTERVAL ${Number(c.offsetMinutes)} MINUTE)`;
  switch (c.filters.groupBy) {
    case 'week': return `DATE_FORMAT(DATE_SUB(${local}, INTERVAL WEEKDAY(${local}) DAY), '%Y-%m-%d')`;
    case 'month': return `DATE_FORMAT(${local}, '%Y-%m')`;
    case 'year': return `DATE_FORMAT(${local}, '%Y')`;
    default: return `DATE_FORMAT(${local}, '%Y-%m-%d')`;
  }
}

function billFilters(c: ReportCtx, alias = 'b') {
  const w: string[] = []; const p: unknown[] = [];
  if (c.filters.branchId) { w.push(`${alias}.branch_id=?`); p.push(c.filters.branchId); }
  if (c.filters.orderType) { w.push(`${alias}.order_type=?`); p.push(c.filters.orderType); }
  if (c.filters.channel) { w.push(`${alias}.channel=?`); p.push(c.filters.channel); }
  if (c.filters.employeeId) { w.push(`${alias}.closed_by=?`); p.push(c.filters.employeeId); }
  if (c.filters.paymentMethod) { w.push(`EXISTS (SELECT 1 FROM payments px WHERE px.bill_id=${alias}.id AND px.method_type=? AND px.status IN ('approved','cash_collected'))`); p.push(c.filters.paymentMethod); }
  if (c.filters.categoryId) { w.push(`EXISTS (SELECT 1 FROM orders ox JOIN order_items ix ON ix.order_id=ox.id WHERE ox.bill_id=${alias}.id AND ix.category_id=?)`); p.push(c.filters.categoryId); }
  if (c.filters.itemId) { w.push(`EXISTS (SELECT 1 FROM orders ox JOIN order_items ix ON ix.order_id=ox.id WHERE ox.bill_id=${alias}.id AND ix.menu_item_id=?)`); p.push(c.filters.itemId); }
  return { sql: w.length ? ' AND ' + w.join(' AND ') : '', params: p };
}

const sum = (rows: any[], k: string) => rows.reduce((s, r) => s.plus(D(r[k] ?? 0)), D(0)).toFixed(4);

export async function runReport(key: string, c: ReportCtx): Promise<ReportData> {
  const rid = c.restaurantId; const R = [rid, c.from, c.to];
  const title = REPORTS[key]?.title;
  if (!title) throw badRequest('Unknown report');
  const bf = billFilters(c);
  switch (key) {
    case 'sales': {
      const rows = await q<any>(`SELECT ${periodExpr('b.closed_at', c)} period, COUNT(*) bills, SUM(b.subtotal) gross, SUM(b.discount_total) discounts,
          SUM((SELECT COALESCE(SUM(t.amount),0) FROM bill_taxes t WHERE t.bill_id=b.id AND t.is_liability=1)) taxes, SUM(b.delivery_charge) delivery, SUM(b.total) total, SUM(b.refunded_total) refunds
        FROM bills b WHERE b.restaurant_id=? AND b.status='closed' AND b.closed_at>=? AND b.closed_at<?${bf.sql} GROUP BY period ORDER BY period`, [...R, ...bf.params]);
      rows.forEach((r) => { r.net = D(r.total).minus(D(r.taxes)).minus(D(r.refunds)).toFixed(4); r.avg = Number(r.bills) ? D(r.total).div(r.bills).toFixed(4) : '0'; });
      return { title, columns: [{ key: 'period', label: 'Period' }, { key: 'bills', label: 'Bills', type: 'number' }, { key: 'gross', label: 'Gross sales', type: 'money' }, { key: 'discounts', label: 'Discounts', type: 'money' }, { key: 'taxes', label: 'Taxes', type: 'money' }, { key: 'delivery', label: 'Delivery', type: 'money' }, { key: 'total', label: 'Billed total', type: 'money' }, { key: 'refunds', label: 'Refunds', type: 'money' }, { key: 'net', label: 'Net sales', type: 'money' }, { key: 'avg', label: 'Avg bill', type: 'money' }],
        rows, summary: [{ label: 'Bills', value: String(rows.reduce((s, r) => s + Number(r.bills), 0)), type: 'number' }, { label: 'Gross sales', value: sum(rows, 'gross'), type: 'money' }, { label: 'Discounts', value: sum(rows, 'discounts'), type: 'money' }, { label: 'Net sales (excl. tax & refunds)', value: sum(rows, 'net'), type: 'money' }],
        notes: ['Net sales exclude tax liabilities and refunds. Only closed bills are included; open and unpaid bills are not revenue.'] };
    }
    case 'revenue': {
      const rows = await q<any>(`SELECT b.channel, b.order_type, COUNT(*) bills, SUM(b.total) total,
          SUM(b.total - (SELECT COALESCE(SUM(t.amount),0) FROM bill_taxes t WHERE t.bill_id=b.id AND t.is_liability=1)) revenue
        FROM bills b WHERE b.restaurant_id=? AND b.status='closed' AND b.closed_at>=? AND b.closed_at<?${bf.sql} GROUP BY b.channel, b.order_type ORDER BY revenue DESC`, [...R, ...bf.params]);
      return { title, columns: [{ key: 'channel', label: 'Channel' }, { key: 'order_type', label: 'Order type' }, { key: 'bills', label: 'Bills', type: 'number' }, { key: 'total', label: 'Billed (incl. tax)', type: 'money' }, { key: 'revenue', label: 'Revenue (excl. tax)', type: 'money' }], rows, summary: [{ label: 'Revenue', value: sum(rows, 'revenue'), type: 'money' }] };
    }
    case 'expenses': {
      const b = c.filters.branchId ? ' AND branch_id=?' : ''; const bp = c.filters.branchId ? [c.filters.branchId] : [];
      const rows = await q<any>(`SELECT category, COUNT(*) entries, SUM(amount) amount FROM expenses WHERE restaurant_id=? AND expense_date>=DATE(DATE_ADD(?, INTERVAL ${c.offsetMinutes} MINUTE)) AND expense_date<DATE(DATE_ADD(?, INTERVAL ${c.offsetMinutes} MINUTE))${b} GROUP BY category ORDER BY amount DESC`, [...R, ...bp]);
      const payroll = await one<any>("SELECT COALESCE(SUM(debit-credit),0) v FROM ledger_entries WHERE restaurant_id=? AND account='payroll' AND entry_at>=? AND entry_at<?", R);
      if (D(payroll.v).gt(0)) rows.push({ category: 'payroll (paid)', entries: '', amount: payroll.v });
      return { title, columns: [{ key: 'category', label: 'Category' }, { key: 'entries', label: 'Entries' }, { key: 'amount', label: 'Amount', type: 'money' }], rows, summary: [{ label: 'Total expenses', value: sum(rows, 'amount'), type: 'money' }] };
    }
    case 'pnl': {
      const p = await profitAndLoss(pool, rid, c.from, c.to, c.filters.branchId);
      const rows = [
        { line: 'Sales (excl. tax)', amount: p.sales }, { line: 'Service charges kept', amount: p.serviceRevenue }, { line: 'Delivery revenue', amount: p.deliveryRevenue },
        { line: 'Less: discounts', amount: D(p.discounts).neg().toFixed(4) }, { line: 'Less: refunds', amount: D(p.refunds).neg().toFixed(4) }, { line: 'Net sales', amount: p.netSales },
        { line: 'Cost of goods sold', amount: D(p.cogs).neg().toFixed(4) }, { line: 'Gross profit', amount: p.grossProfit },
        ...Object.entries(p.operatingExpenses).map(([k, v]) => ({ line: `Expense: ${k}`, amount: D(v).neg().toFixed(4) })),
        { line: 'Payroll', amount: D(p.payroll).neg().toFixed(4) }, { line: 'Wastage', amount: D(p.wastage).neg().toFixed(4) }, { line: 'Complimentary items', amount: D(p.complimentary).neg().toFixed(4) },
        { line: 'Payment fees', amount: D(p.paymentFees).neg().toFixed(4) }, { line: 'Billing losses', amount: D(p.billingLoss).neg().toFixed(4) }, { line: 'Stock adjustments', amount: D(p.stockAdjustment).neg().toFixed(4) },
        { line: 'Net profit', amount: p.netProfit },
      ];
      return { title, columns: [{ key: 'line', label: 'Line' }, { key: 'amount', label: 'Amount', type: 'money' }], rows,
        summary: [{ label: 'Net sales', value: p.netSales, type: 'money' }, { label: 'Gross profit', value: p.grossProfit, type: 'money' }, { label: 'Gross margin', value: `${p.grossMarginPct}%` }, { label: 'Net profit', value: p.netProfit, type: 'money' }, { label: 'Taxes collected (liability)', value: p.taxesCollected, type: 'money' }, { label: 'Neutral discrepancies (not in profit)', value: p.neutralDiscrepancies, type: 'money' }],
        notes: ['Built from the double-entry ledger. Taxes collected are liabilities and excluded from profit. Neutral discrepancies are held in suspense and do not affect profit.'] };
    }
    case 'cash': {
      const rows = await q<any>(`SELECT ${periodExpr('l.entry_at', c)} period, SUM(l.debit) cash_in, SUM(l.credit) cash_out, SUM(l.debit-l.credit) net FROM ledger_entries l WHERE l.restaurant_id=? AND l.account='cash' AND l.entry_at>=? AND l.entry_at<? GROUP BY period ORDER BY period`, R);
      const shifts = await q<any>('SELECT s.id, u.name, s.opened_at, s.closed_at, s.opening_cash, s.expected_cash, s.counted_cash, s.difference FROM pos_shifts s JOIN users u ON u.id=s.user_id WHERE s.restaurant_id=? AND s.opened_at>=? AND s.opened_at<? ORDER BY s.id', R);
      return { title, columns: [{ key: 'period', label: 'Period' }, { key: 'cash_in', label: 'Cash in', type: 'money' }, { key: 'cash_out', label: 'Cash out', type: 'money' }, { key: 'net', label: 'Net cash', type: 'money' }], rows,
        summary: [{ label: 'Cash in', value: sum(rows, 'cash_in'), type: 'money' }, { label: 'Cash out', value: sum(rows, 'cash_out'), type: 'money' }, { label: 'Shift differences', value: sum(shifts, 'difference'), type: 'money' }],
        notes: shifts.map((s) => `Shift #${s.id} ${s.name}: opening ${s.opening_cash}, expected ${s.expected_cash ?? '-'}, counted ${s.counted_cash ?? '-'}, difference ${s.difference ?? '-'}`) };
    }
    case 'reconciliation': {
      const pm = c.filters.paymentMethod ? ' AND p.method_type=?' : ''; const pmp = c.filters.paymentMethod ? [c.filters.paymentMethod] : [];
      const rows = await q<any>(`SELECT p.method_type, COALESCE(m.label, p.method_type) method, p.status, COUNT(*) n, SUM(p.amount) amount, SUM(p.fee_amount) fees FROM payments p LEFT JOIN payment_methods m ON m.id=p.method_id
        WHERE p.restaurant_id=? AND p.created_at>=? AND p.created_at<?${pm} GROUP BY p.method_type, method, p.status ORDER BY method, p.status`, [...R, ...pmp]);
      const ledger = await q<any>("SELECT account, SUM(debit) d FROM ledger_entries WHERE restaurant_id=? AND ref_type='payment' AND account IN ('cash','bank','payment_fees') AND entry_at>=? AND entry_at<? GROUP BY account", R);
      const approved = rows.filter((r) => r.status === 'approved' || r.status === 'cash_collected');
      const ledgerTotal = ledger.reduce((s, l) => s.plus(D(l.d)), D(0));
      return { title, columns: [{ key: 'method', label: 'Method' }, { key: 'status', label: 'Status' }, { key: 'n', label: 'Count', type: 'number' }, { key: 'amount', label: 'Amount', type: 'money' }, { key: 'fees', label: 'Fees', type: 'money' }], rows,
        summary: [{ label: 'Approved/collected', value: sum(approved, 'amount'), type: 'money' }, { label: 'Ledger receipts', value: ledgerTotal.toFixed(4), type: 'money' }, { label: 'Reconciled', value: D(sum(approved, 'amount')).eq(ledgerTotal) ? 'Yes' : 'No — investigate' }, { label: 'Pending review', value: sum(rows.filter((r) => ['submitted', 'under_review', 'cash_requested'].includes(r.status)), 'amount'), type: 'money' }] };
    }
    case 'tax': {
      const rows = await q<any>(`SELECT ${periodExpr('b.closed_at', c)} period, t.name, t.rate, t.inclusive, t.is_liability, COUNT(DISTINCT b.id) bills, SUM(t.taxable_amount) taxable, SUM(t.amount) amount
        FROM bill_taxes t JOIN bills b ON b.id=t.bill_id WHERE b.restaurant_id=? AND b.status='closed' AND b.closed_at>=? AND b.closed_at<?${bf.sql} GROUP BY period, t.name, t.rate, t.inclusive, t.is_liability ORDER BY period, t.name`, [...R, ...bf.params]);
      const totals = new Map<string, any>();
      for (const r of rows) totals.set(r.name, D(totals.get(r.name) ?? 0).plus(D(r.amount)));
      const refundsTax = await one<any>('SELECT COALESCE(SUM(tax_portion),0) v FROM refunds WHERE restaurant_id=? AND created_at>=? AND created_at<?', R);
      return { title, columns: [{ key: 'period', label: 'Period' }, { key: 'name', label: 'Tax' }, { key: 'rate', label: 'Rate %', type: 'number' }, { key: 'bills', label: 'Bills', type: 'number' }, { key: 'taxable', label: 'Taxable amount', type: 'money' }, { key: 'amount', label: 'Tax amount', type: 'money' }],
        rows, summary: [...[...totals.entries()].map(([k, v]) => ({ label: k, value: D(v).toFixed(4), type: 'money' as const })), { label: 'Tax reversed by refunds', value: refundsTax.v, type: 'money' }],
        notes: ['Each tax is reported separately. Taxes are tax liabilities unless configured as restaurant-kept charges.'] };
    }
    case 'inventory':
    case 'valuation': {
      const bw = c.filters.branchId ? ' AND (i.branch_id=? OR i.branch_id IS NULL)' : ''; const bp = c.filters.branchId ? [c.filters.branchId] : [];
      const rows = await q<any>(`SELECT i.id, i.name, i.unit, i.stock_qty, i.min_qty, i.avg_cost, i.stock_qty*i.avg_cost value,
          (SELECT COALESCE(SUM(-m.quantity),0) FROM stock_movements m WHERE m.ingredient_id=i.id AND m.movement_type IN ('sale','complimentary','wastage') AND m.created_at>=? AND m.created_at<?) consumed,
          (SELECT COALESCE(SUM(m.quantity),0) FROM stock_movements m WHERE m.ingredient_id=i.id AND m.movement_type='purchase' AND m.created_at>=? AND m.created_at<?) purchased
        FROM ingredients i WHERE i.restaurant_id=? AND i.active=1${bw} ORDER BY i.name`, [c.from, c.to, c.from, c.to, rid, ...bp]);
      rows.forEach((r) => { r.status = D(r.min_qty).gt(0) && D(r.stock_qty).lte(D(r.min_qty)) ? 'LOW' : 'OK'; });
      return { title: key === 'valuation' ? 'Stock valuation' : title, columns: [{ key: 'name', label: 'Item' }, { key: 'unit', label: 'Unit' }, { key: 'stock_qty', label: 'In stock', type: 'number' }, { key: 'min_qty', label: 'Minimum', type: 'number' }, { key: 'purchased', label: 'Purchased', type: 'number' }, { key: 'consumed', label: 'Consumed', type: 'number' }, { key: 'avg_cost', label: 'Avg cost', type: 'money' }, { key: 'value', label: 'Value', type: 'money' }, { key: 'status', label: 'Status' }],
        rows, summary: [{ label: 'Inventory value', value: sum(rows, 'value'), type: 'money' }, { label: 'Low-stock items', value: String(rows.filter((r) => r.status === 'LOW').length) }] };
    }
    case 'purchases': {
      const rows = await q<any>(`SELECT p.id, p.purchase_date, p.reference, s.name supplier, p.paid_via, p.extra_charges, p.total FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id
        WHERE p.restaurant_id=? AND p.created_at>=? AND p.created_at<? ${c.filters.branchId ? 'AND p.branch_id=?' : ''} ORDER BY p.purchase_date, p.id`, [...R, ...(c.filters.branchId ? [c.filters.branchId] : [])]);
      return { title, columns: [{ key: 'purchase_date', label: 'Date' }, { key: 'reference', label: 'Reference' }, { key: 'supplier', label: 'Supplier' }, { key: 'paid_via', label: 'Paid via' }, { key: 'extra_charges', label: 'Extra charges', type: 'money' }, { key: 'total', label: 'Total', type: 'money' }], rows, summary: [{ label: 'Total purchases', value: sum(rows, 'total'), type: 'money' }] };
    }
    case 'food_cost':
    case 'recipe_profitability': {
      const cat = c.filters.categoryId ? ' AND mi.category_id=?' : ''; const cp = c.filters.categoryId ? [c.filters.categoryId] : [];
      const items = await q<any>(`SELECT mi.id, mi.name, mi.price, mc.name category,
          (SELECT COALESCE(SUM(oi.quantity),0) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.menu_item_id=mi.id AND oi.status<>'cancelled' AND oi.is_complimentary=0 AND o.status IN ('accepted','preparing','ready','served','completed') AND o.created_at>=? AND o.created_at<?) sold,
          (SELECT COALESCE(SUM(oi.line_total),0) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.menu_item_id=mi.id AND oi.status<>'cancelled' AND o.status IN ('accepted','preparing','ready','served','completed') AND o.created_at>=? AND o.created_at<?) revenue,
          (SELECT COALESCE(SUM(le.debit-le.credit),0) FROM ledger_entries le JOIN order_items oi ON oi.id=le.ref_id WHERE le.restaurant_id=mi.restaurant_id AND le.ref_type IN ('order_item_cogs','order_item_cogs_reversal') AND le.account='cogs' AND oi.menu_item_id=mi.id AND le.entry_at>=? AND le.entry_at<?) actual_cost
        FROM menu_items mi JOIN menu_categories mc ON mc.id=mi.category_id WHERE mi.restaurant_id=? AND mi.active=1${cat} ORDER BY mc.sort_order, mi.name`, [c.from, c.to, c.from, c.to, c.from, c.to, rid, ...cp]);
      for (const it of items) {
        const cost = await recipeCost(pool, rid, it.id, null);
        it.recipe_cost = cost ? cost.toFixed(4) : null;
        it.gross_profit = cost ? D(it.price).minus(cost).toFixed(4) : null;
        it.margin_pct = cost && D(it.price).gt(0) ? D(it.price).minus(cost).div(it.price).times(100).toFixed(2) : null;
        it.food_cost_pct = cost && D(it.price).gt(0) ? cost.div(it.price).times(100).toFixed(2) : null;
        it.actual_food_cost_pct = D(it.revenue).gt(0) ? D(it.actual_cost).div(D(it.revenue)).times(100).toFixed(2) : null;
        it.period_profit = D(it.revenue).minus(D(it.actual_cost)).toFixed(4);
      }
      const totalRev = items.reduce((s, i) => s.plus(D(i.revenue)), D(0)); const totalCost = items.reduce((s, i) => s.plus(D(i.actual_cost)), D(0));
      const flagged = items.filter((i) => i.food_cost_pct && D(i.food_cost_pct).gt(35)).map((i) => i.name);
      if (key === 'food_cost') return { title, columns: [{ key: 'category', label: 'Category' }, { key: 'name', label: 'Item' }, { key: 'price', label: 'Price', type: 'money' }, { key: 'recipe_cost', label: 'Recipe cost (est.)', type: 'money' }, { key: 'food_cost_pct', label: 'Est. food cost %', type: 'percent' }, { key: 'margin_pct', label: 'Est. margin %', type: 'percent' }, { key: 'actual_food_cost_pct', label: 'Actual food cost %', type: 'percent' }],
        rows: items, summary: [{ label: 'Item revenue', value: totalRev.toFixed(4), type: 'money' }, { label: 'Actual COGS', value: totalCost.toFixed(4), type: 'money' }, { label: 'Actual food cost', value: totalRev.gt(0) ? `${totalCost.div(totalRev).times(100).toFixed(2)}%` : 'n/a' }],
        notes: ['"Est." values use the current recipe and weighted-average ingredient cost. "Actual" uses COGS recorded from real stock consumption in the period.', flagged.length ? `High ingredient cost (>35%): ${flagged.join(', ')}` : 'No items above 35% estimated food cost.'] };
      const rows = items.filter((i) => Number(i.sold) > 0).sort((a, b) => D(b.period_profit).cmp(D(a.period_profit)));
      return { title, columns: [{ key: 'name', label: 'Item' }, { key: 'category', label: 'Category' }, { key: 'sold', label: 'Sold', type: 'number' }, { key: 'revenue', label: 'Revenue', type: 'money' }, { key: 'actual_cost', label: 'Actual cost', type: 'money' }, { key: 'period_profit', label: 'Gross profit', type: 'money' }, { key: 'margin_pct', label: 'Est. margin %', type: 'percent' }],
        rows, summary: [{ label: 'Best item', value: rows[0]?.name ?? '-' }, { label: 'Worst item', value: rows[rows.length - 1]?.name ?? '-' }, { label: 'Gross profit', value: totalRev.minus(totalCost).toFixed(4), type: 'money' }] };
    }
    case 'wastage': {
      const rows = await q<any>(`SELECT w.occurred_at, w.kind, COALESCE(i.name, mi.name) item, w.quantity, w.cost, w.reason, u.name employee, w.status FROM wastage_records w
        LEFT JOIN ingredients i ON i.id=w.ingredient_id LEFT JOIN menu_items mi ON mi.id=w.menu_item_id LEFT JOIN users u ON u.id=w.employee_id
        WHERE w.restaurant_id=? AND w.occurred_at>=? AND w.occurred_at<? AND w.kind<>'complimentary' ${c.filters.branchId ? 'AND w.branch_id=?' : ''} ORDER BY w.occurred_at`, [...R, ...(c.filters.branchId ? [c.filters.branchId] : [])]);
      const byKind = new Map<string, any>(); rows.filter((r) => r.status === 'approved').forEach((r) => byKind.set(r.kind, D(byKind.get(r.kind) ?? 0).plus(D(r.cost))));
      return { title, columns: [{ key: 'occurred_at', label: 'When', type: 'date' }, { key: 'kind', label: 'Type' }, { key: 'item', label: 'Item' }, { key: 'quantity', label: 'Qty', type: 'number' }, { key: 'cost', label: 'Cost', type: 'money' }, { key: 'reason', label: 'Reason' }, { key: 'employee', label: 'Employee' }, { key: 'status', label: 'Status' }],
        rows, summary: [{ label: 'Approved wastage cost', value: sum(rows.filter((r) => r.status === 'approved'), 'cost'), type: 'money' }, ...[...byKind.entries()].map(([k, v]) => ({ label: k, value: D(v).toFixed(4), type: 'money' as const }))] };
    }
    case 'complimentary': {
      const rows = await q<any>(`SELECT o.created_at, o.order_no, oi.name, oi.quantity, oi.complimentary_reason reason, u.name staff,
          (SELECT COALESCE(SUM(le.debit),0) FROM ledger_entries le WHERE le.ref_type='order_item_cogs' AND le.ref_id=oi.id AND le.account='complimentary_cost') cost,
          oi.unit_price*oi.quantity menu_value
        FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN users u ON u.id=o.created_by_user_id WHERE oi.restaurant_id=? AND oi.is_complimentary=1 AND oi.status<>'cancelled' AND o.created_at>=? AND o.created_at<? ORDER BY o.created_at`, R);
      const w = await q<any>("SELECT occurred_at created_at, '' order_no, reason name, quantity, reason, '' staff, cost, 0 menu_value FROM wastage_records WHERE restaurant_id=? AND kind='complimentary' AND status='approved' AND occurred_at>=? AND occurred_at<?", R);
      const all = [...rows, ...w];
      return { title, columns: [{ key: 'created_at', label: 'When', type: 'date' }, { key: 'order_no', label: 'Order' }, { key: 'name', label: 'Item' }, { key: 'quantity', label: 'Qty', type: 'number' }, { key: 'menu_value', label: 'Menu value (not revenue)', type: 'money' }, { key: 'cost', label: 'Cost', type: 'money' }, { key: 'reason', label: 'Reason' }, { key: 'staff', label: 'Staff' }],
        rows: all, summary: [{ label: 'Cost of complimentary items', value: sum(all, 'cost'), type: 'money' }, { label: 'Menu value given away', value: sum(all, 'menu_value'), type: 'money' }], notes: ['Complimentary items are never counted as revenue; their ingredient cost is expensed as complimentary cost.'] };
    }
    case 'payroll': {
      const rows = await q<any>(`SELECT p.period_start, p.period_end, u.name, p.base_salary, p.bonuses, p.deductions, p.advances, p.net_pay, p.status, p.paid_via, p.paid_at FROM payroll_entries p JOIN users u ON u.id=p.user_id
        WHERE p.restaurant_id=? AND p.period_start<DATE(DATE_ADD(?, INTERVAL ${c.offsetMinutes} MINUTE)) AND p.period_end>=DATE(DATE_ADD(?, INTERVAL ${c.offsetMinutes} MINUTE)) ${c.filters.employeeId ? 'AND p.user_id=?' : ''} ORDER BY p.period_start, u.name`, [rid, c.to, c.from, ...(c.filters.employeeId ? [c.filters.employeeId] : [])]);
      return { title, columns: [{ key: 'period_start', label: 'From' }, { key: 'period_end', label: 'To' }, { key: 'name', label: 'Employee' }, { key: 'base_salary', label: 'Base', type: 'money' }, { key: 'bonuses', label: 'Bonuses', type: 'money' }, { key: 'deductions', label: 'Deductions', type: 'money' }, { key: 'advances', label: 'Advances', type: 'money' }, { key: 'net_pay', label: 'Net pay', type: 'money' }, { key: 'status', label: 'Status' }],
        rows, summary: [{ label: 'Total net pay', value: sum(rows, 'net_pay'), type: 'money' }, { label: 'Unpaid', value: sum(rows.filter((r) => r.status === 'unpaid'), 'net_pay'), type: 'money' }] };
    }
    case 'employees': {
      const rows = await q<any>(`SELECT u.id, u.name, r.name role,
          (SELECT COUNT(*) FROM orders o WHERE o.created_by_user_id=u.id AND o.created_at>=? AND o.created_at<?) orders_created,
          (SELECT COUNT(*) FROM orders o WHERE o.served_by_user_id=u.id AND o.served_at>=? AND o.served_at<?) orders_served,
          (SELECT COUNT(*) FROM payments p WHERE p.approved_by=u.id AND p.approved_at>=? AND p.approved_at<?) payments_handled,
          (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.approved_by=u.id AND p.status IN ('approved','cash_collected') AND p.approved_at>=? AND p.approved_at<?) amount_handled,
          (SELECT COUNT(*) FROM waiter_tasks t WHERE t.assigned_to=u.id AND t.status='completed' AND t.updated_at>=? AND t.updated_at<?) tasks_completed,
          (SELECT AVG(f.service_rating) FROM feedback f JOIN orders o ON o.id=f.order_id WHERE o.served_by_user_id=u.id AND f.created_at>=? AND f.created_at<?) avg_service_rating
        FROM users u LEFT JOIN roles r ON r.id=u.role_id WHERE u.restaurant_id=? ${c.filters.employeeId ? 'AND u.id=?' : ''} ORDER BY u.name`, [c.from, c.to, c.from, c.to, c.from, c.to, c.from, c.to, c.from, c.to, c.from, c.to, rid, ...(c.filters.employeeId ? [c.filters.employeeId] : [])]);
      return { title, columns: [{ key: 'name', label: 'Employee' }, { key: 'role', label: 'Role' }, { key: 'orders_created', label: 'Orders created', type: 'number' }, { key: 'orders_served', label: 'Orders served', type: 'number' }, { key: 'payments_handled', label: 'Payments handled', type: 'number' }, { key: 'amount_handled', label: 'Amount handled', type: 'money' }, { key: 'tasks_completed', label: 'Tasks done', type: 'number' }, { key: 'avg_service_rating', label: 'Service rating', type: 'number' }], rows };
    }
    case 'customers': {
      const rows = await q<any>(`SELECT c.name, c.phone, c.visit_count, c.total_spent, c.loyalty_points, c.last_visit_at, c.marketing_opt_in,
          (SELECT COUNT(*) FROM bills b WHERE b.customer_id=c.id AND b.status='closed' AND b.closed_at>=? AND b.closed_at<?) period_visits,
          (SELECT COALESCE(SUM(b.total),0) FROM bills b WHERE b.customer_id=c.id AND b.status='closed' AND b.closed_at>=? AND b.closed_at<?) period_spent
        FROM customers c WHERE c.restaurant_id=? ORDER BY period_spent DESC, c.total_spent DESC LIMIT 1000`, [c.from, c.to, c.from, c.to, rid]);
      return { title, columns: [{ key: 'name', label: 'Customer' }, { key: 'phone', label: 'Phone' }, { key: 'period_visits', label: 'Visits (period)', type: 'number' }, { key: 'period_spent', label: 'Spent (period)', type: 'money' }, { key: 'visit_count', label: 'Lifetime visits', type: 'number' }, { key: 'total_spent', label: 'Lifetime spent', type: 'money' }, { key: 'loyalty_points', label: 'Points', type: 'number' }, { key: 'last_visit_at', label: 'Last visit', type: 'date' }], rows };
    }
    case 'loyalty': {
      const rows = await q<any>(`SELECT c.name, c.phone, SUM(CASE WHEN l.points>0 THEN l.points ELSE 0 END) earned, SUM(CASE WHEN l.points<0 THEN -l.points ELSE 0 END) redeemed, c.loyalty_points balance
        FROM loyalty_transactions l JOIN customers c ON c.id=l.customer_id WHERE l.restaurant_id=? AND l.created_at>=? AND l.created_at<? GROUP BY c.id ORDER BY earned DESC`, R);
      const coupons = await q<any>('SELECT code, used_count, max_uses FROM coupons WHERE restaurant_id=? ORDER BY used_count DESC', [rid]);
      return { title, columns: [{ key: 'name', label: 'Customer' }, { key: 'phone', label: 'Phone' }, { key: 'earned', label: 'Points earned', type: 'number' }, { key: 'redeemed', label: 'Points redeemed', type: 'number' }, { key: 'balance', label: 'Balance', type: 'number' }], rows, notes: coupons.map((cp) => `Coupon ${cp.code}: used ${cp.used_count}${cp.max_uses ? ' / ' + cp.max_uses : ''}`) };
    }
    case 'reservations': {
      const rows = await q<any>(`SELECT ${periodExpr('reserved_for', c)} period, status, COUNT(*) n, SUM(party_size) guests FROM reservations WHERE restaurant_id=? AND reserved_for>=? AND reserved_for<? ${c.filters.branchId ? 'AND branch_id=?' : ''} GROUP BY period, status ORDER BY period, status`, [...R, ...(c.filters.branchId ? [c.filters.branchId] : [])]);
      return { title, columns: [{ key: 'period', label: 'Period' }, { key: 'status', label: 'Status' }, { key: 'n', label: 'Reservations', type: 'number' }, { key: 'guests', label: 'Guests', type: 'number' }], rows };
    }
    case 'orders': {
      const w = billFilters(c, 'o');
      const rows = await q<any>(`SELECT o.channel, o.order_type, o.status, COUNT(*) n, AVG(TIMESTAMPDIFF(SECOND, o.submitted_at, o.accepted_at))/60 accept_min, AVG(TIMESTAMPDIFF(SECOND, o.accepted_at, o.ready_at))/60 prep_min,
          AVG(TIMESTAMPDIFF(SECOND, o.ready_at, o.served_at))/60 serve_min, AVG(o.prep_estimate_minutes) est_min
        FROM orders o WHERE o.restaurant_id=? AND o.created_at>=? AND o.created_at<? AND o.status<>'draft'${w.sql.replace(/o\.closed_by/g, 'o.created_by_user_id')} GROUP BY o.channel, o.order_type, o.status ORDER BY n DESC`, [...R, ...w.params]);
      return { title, columns: [{ key: 'channel', label: 'Channel' }, { key: 'order_type', label: 'Type' }, { key: 'status', label: 'Status' }, { key: 'n', label: 'Orders', type: 'number' }, { key: 'accept_min', label: 'Avg accept (min)', type: 'number' }, { key: 'est_min', label: 'Avg estimate (min)', type: 'number' }, { key: 'prep_min', label: 'Avg prep (min)', type: 'number' }, { key: 'serve_min', label: 'Avg ready→served (min)', type: 'number' }], rows };
    }
    case 'kitchen': {
      const rows = await q<any>(`SELECT COALESCE(s.name, 'Unassigned') station, COUNT(*) tickets, AVG(TIMESTAMPDIFF(SECOND, kt.created_at, kt.started_at))/60 wait_min, AVG(TIMESTAMPDIFF(SECOND, kt.created_at, kt.ready_at))/60 ready_min,
          SUM(CASE WHEN TIMESTAMPDIFF(MINUTE, kt.created_at, kt.ready_at) > COALESCE(o.prep_estimate_minutes, 20) THEN 1 ELSE 0 END) late
        FROM kitchen_tickets kt JOIN orders o ON o.id=kt.order_id LEFT JOIN kitchen_stations s ON s.id=kt.station_id WHERE kt.restaurant_id=? AND kt.created_at>=? AND kt.created_at<? AND kt.status<>'cancelled' GROUP BY station ORDER BY tickets DESC`, R);
      return { title, columns: [{ key: 'station', label: 'Station' }, { key: 'tickets', label: 'Tickets', type: 'number' }, { key: 'wait_min', label: 'Avg wait to start (min)', type: 'number' }, { key: 'ready_min', label: 'Avg to ready (min)', type: 'number' }, { key: 'late', label: 'Late tickets', type: 'number' }], rows };
    }
    case 'branches': {
      const rows = await q<any>(`SELECT COALESCE(br.name, 'Unassigned') branch, COUNT(b.id) bills, COALESCE(SUM(b.total),0) total, COALESCE(AVG(b.total),0) avg_bill,
          (SELECT COALESCE(SUM(e.amount),0) FROM expenses e WHERE e.branch_id=br.id AND e.expense_date>=DATE(DATE_ADD(?, INTERVAL ${c.offsetMinutes} MINUTE)) AND e.expense_date<DATE(DATE_ADD(?, INTERVAL ${c.offsetMinutes} MINUTE))) expenses
        FROM branches br LEFT JOIN bills b ON b.branch_id=br.id AND b.status='closed' AND b.closed_at>=? AND b.closed_at<? WHERE br.restaurant_id=? GROUP BY br.id ORDER BY total DESC`, [c.from, c.to, c.from, c.to, rid]);
      return { title, columns: [{ key: 'branch', label: 'Branch' }, { key: 'bills', label: 'Bills', type: 'number' }, { key: 'total', label: 'Sales', type: 'money' }, { key: 'avg_bill', label: 'Avg bill', type: 'money' }, { key: 'expenses', label: 'Expenses', type: 'money' }], rows, summary: [{ label: 'Consolidated sales', value: sum(rows, 'total'), type: 'money' }] };
    }
  }
  throw badRequest('Unknown report');
}
