import { exec, q, type Db } from '../lib/db.js';
import { D, Decimal } from '../lib/money.js';
import { uuid } from '../lib/crypto.js';

/**
 * Double-entry ledger. Account conventions (normal balance in brackets):
 *  Assets      : cash [Dr], bank [Dr], receivable [Dr], inventory [Dr], discrepancy_suspense [Dr]
 *  Liabilities : tax_payable [Cr], accounts_payable [Cr]
 *  Equity      : owner_equity [Cr]
 *  Revenue     : sales [Cr], service_revenue [Cr], delivery_revenue [Cr]
 *  Contra rev. : discounts [Dr], refunds [Dr]
 *  Expenses    : cogs, complimentary_cost, wastage, payroll, payment_fees, billing_loss, stock_adjustment, opex_<category> [Dr]
 *
 * Revenue is recognised when a bill is closed. Payments received before closure sit as a credit
 * on `receivable` (customer deposit). Unpaid open bills are not revenue. Taxes flagged as liabilities
 * are never revenue. A "neutral" billing discrepancy goes to `discrepancy_suspense` (balance sheet), a
 * "loss" goes to `billing_loss` (P&L).
 */
export type Account =
  | 'cash' | 'bank' | 'receivable' | 'inventory' | 'discrepancy_suspense'
  | 'tax_payable' | 'accounts_payable' | 'owner_equity'
  | 'sales' | 'service_revenue' | 'delivery_revenue' | 'discounts' | 'refunds'
  | 'cogs' | 'complimentary_cost' | 'wastage' | 'payroll' | 'payment_fees' | 'billing_loss' | 'stock_adjustment'
  | `opex_${string}`;

export interface Leg { account: Account; debit?: Decimal.Value; credit?: Decimal.Value }

export async function postTxn(db: Db, p: {
  restaurantId: number; branchId?: number | null; refType: string; refId?: number | null; memo?: string; at?: Date; legs: Leg[];
}) {
  const legs = p.legs
    .map((l) => ({ account: l.account, debit: D(l.debit ?? 0), credit: D(l.credit ?? 0) }))
    .filter((l) => !l.debit.isZero() || !l.credit.isZero());
  if (!legs.length) return null;
  const dr = legs.reduce((s, l) => s.plus(l.debit), D(0));
  const cr = legs.reduce((s, l) => s.plus(l.credit), D(0));
  if (!dr.eq(cr)) throw new Error(`Unbalanced ledger transaction for ${p.refType}#${p.refId}: Dr ${dr} != Cr ${cr}`);
  for (const l of legs) if (l.debit.isNeg() || l.credit.isNeg()) throw new Error('Ledger legs must be non-negative');
  const txnId = uuid();
  const at = p.at ?? new Date();
  const values = legs.map((l) => [p.restaurantId, p.branchId ?? null, txnId, at, l.account, l.debit.toFixed(4), l.credit.toFixed(4), p.refType, p.refId ?? null, p.memo?.slice(0, 300) ?? null]);
  await exec('INSERT INTO ledger_entries (restaurant_id, branch_id, txn_id, entry_at, account, debit, credit, ref_type, ref_id, memo) VALUES ?', [values], db);
  return txnId;
}

/** Reverse every ledger leg posted for a reference (used for corrections). */
export async function reverseRef(db: Db, restaurantId: number, refType: string, refId: number, memo: string) {
  const rows = await q<{ account: Account; debit: string; credit: string; branch_id: number | null }>(
    'SELECT account, debit, credit, branch_id FROM ledger_entries WHERE restaurant_id=? AND ref_type=? AND ref_id=?',
    [restaurantId, refType, refId], db);
  if (!rows.length) return null;
  return postTxn(db, {
    restaurantId, branchId: rows[0].branch_id, refType: `${refType}_reversal`, refId, memo,
    legs: rows.map((r) => ({ account: r.account, debit: r.credit, credit: r.debit })),
  });
}

export const cashAccount = (methodType: string): Account => (methodType === 'cash' ? 'cash' : 'bank');

export interface PnL {
  sales: string; serviceRevenue: string; deliveryRevenue: string; discounts: string; refunds: string; netSales: string;
  cogs: string; grossProfit: string; grossMarginPct: string;
  operatingExpenses: Record<string, string>; operatingExpensesTotal: string;
  payroll: string; wastage: string; complimentary: string; paymentFees: string; billingLoss: string; stockAdjustment: string;
  netProfit: string; taxesCollected: string; neutralDiscrepancies: string;
}

export async function profitAndLoss(db: Db, restaurantId: number, fromUtc: Date, toUtc: Date, branchId?: number | null): Promise<PnL> {
  const params: unknown[] = [restaurantId, fromUtc, toUtc];
  let branchSql = '';
  if (branchId) { branchSql = ' AND branch_id=?'; params.push(branchId); }
  const rows = await q<{ account: string; dr: string; cr: string }>(
    `SELECT account, SUM(debit) dr, SUM(credit) cr FROM ledger_entries WHERE restaurant_id=? AND entry_at>=? AND entry_at<?${branchSql} GROUP BY account`, params, db);
  const bal = (a: string, side: 'cr' | 'dr') => {
    const r = rows.find((x) => x.account === a);
    if (!r) return D(0);
    return side === 'cr' ? D(r.cr).minus(D(r.dr)) : D(r.dr).minus(D(r.cr));
  };
  const sales = bal('sales', 'cr'), service = bal('service_revenue', 'cr'), delivery = bal('delivery_revenue', 'cr');
  const discounts = bal('discounts', 'dr'), refunds = bal('refunds', 'dr');
  const netSales = sales.plus(service).plus(delivery).minus(discounts).minus(refunds);
  const cogs = bal('cogs', 'dr');
  const gross = netSales.minus(cogs);
  const opex: Record<string, string> = {};
  let opexTotal = D(0);
  for (const r of rows.filter((x) => x.account.startsWith('opex_'))) {
    const v = D(r.dr).minus(D(r.cr));
    opex[r.account.slice(5)] = v.toFixed(4);
    opexTotal = opexTotal.plus(v);
  }
  const payroll = bal('payroll', 'dr'), wastage = bal('wastage', 'dr'), comp = bal('complimentary_cost', 'dr');
  const fees = bal('payment_fees', 'dr'), loss = bal('billing_loss', 'dr'), adj = bal('stock_adjustment', 'dr');
  const net = gross.minus(opexTotal).minus(payroll).minus(wastage).minus(comp).minus(fees).minus(loss).minus(adj);
  const taxRows = await q<{ cr: string; dr: string }>(
    `SELECT COALESCE(SUM(credit),0) cr, COALESCE(SUM(debit),0) dr FROM ledger_entries WHERE restaurant_id=? AND account='tax_payable' AND ref_type IN ('bill','refund') AND entry_at>=? AND entry_at<?${branchSql}`, params, db);
  return {
    sales: sales.toFixed(4), serviceRevenue: service.toFixed(4), deliveryRevenue: delivery.toFixed(4),
    discounts: discounts.toFixed(4), refunds: refunds.toFixed(4), netSales: netSales.toFixed(4),
    cogs: cogs.toFixed(4), grossProfit: gross.toFixed(4),
    grossMarginPct: netSales.gt(0) ? gross.div(netSales).times(100).toFixed(2) : '0.00',
    operatingExpenses: opex, operatingExpensesTotal: opexTotal.toFixed(4),
    payroll: payroll.toFixed(4), wastage: wastage.toFixed(4), complimentary: comp.toFixed(4), paymentFees: fees.toFixed(4),
    billingLoss: loss.toFixed(4), stockAdjustment: adj.toFixed(4), netProfit: net.toFixed(4),
    taxesCollected: D(taxRows[0]?.cr ?? 0).minus(D(taxRows[0]?.dr ?? 0)).toFixed(4),
    neutralDiscrepancies: bal('discrepancy_suspense', 'dr').toFixed(4),
  };
}

/** Integrity check: all transactions balance. Returns unbalanced txn ids (should be empty). */
export async function unbalancedTransactions(db: Db, restaurantId: number) {
  return q<{ txn_id: string }>('SELECT txn_id FROM ledger_entries WHERE restaurant_id=? GROUP BY txn_id HAVING SUM(debit) <> SUM(credit)', [restaurantId], db);
}
