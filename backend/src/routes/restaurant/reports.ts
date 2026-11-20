import { Router } from 'express';
import { ah } from '../../lib/http.js';
import { forbidden } from '../../lib/errors.js';
import { hasPermission } from '../../lib/permissions.js';
import { requirePerm } from '../../middleware/auth.js';
import { actorFromReq, audit } from '../../lib/audit.js';
import { REPORTS, localRangeToUtc, runReport, type ReportFilters } from '../../services/reports.js';
import { reportPdf, reportXlsx } from '../../services/documents.js';
import { profitAndLoss, unbalancedTransactions } from '../../services/ledger.js';
import { pool, q } from '../../lib/db.js';

export const reportsRouter = Router();

reportsRouter.get('/reports', requirePerm('reports.view'), ah(async (req, res) => {
  const canFin = hasPermission(req.user!.permissions, 'reports.financial');
  res.json({ data: Object.entries(REPORTS).map(([key, r]) => ({ key, title: r.title, financial: !!r.financial, allowed: !r.financial || canFin })) });
}));

reportsRouter.get('/reports/:key', requirePerm('reports.view'), ah(async (req, res) => {
  const key = req.params.key;
  const meta = REPORTS[key];
  if (meta?.financial && !hasPermission(req.user!.permissions, 'reports.financial')) throw forbidden('This report requires financial report access');
  const r = req.restaurant;
  const range = localRangeToUtc(r.timezone, String(req.query.preset || 'this_month'), req.query.from as string, req.query.to as string);
  const num = (v: unknown) => (v ? Number(v) : null);
  const filters: ReportFilters = {
    branchId: num(req.query.branchId), employeeId: num(req.query.employeeId), categoryId: num(req.query.categoryId), itemId: num(req.query.itemId),
    paymentMethod: (req.query.paymentMethod as string) || null, orderType: (req.query.orderType as string) || null, channel: (req.query.channel as string) || null,
    groupBy: (['day', 'week', 'month', 'year'].includes(String(req.query.groupBy)) ? req.query.groupBy : 'day') as ReportFilters['groupBy'],
  };
  const data = await runReport(key, { restaurantId: r.id, currency: r.currency, from: range.from, to: range.to, offsetMinutes: range.offsetMinutes, filters });
  const ctx = { restaurantName: r.name, currency: r.currency, logoFileId: r.logo_file_id, periodLabel: range.label, timezone: r.timezone, locale: r.locale };
  const format = String(req.query.format || 'json');
  const fname = `${r.slug}-${key}-${range.fromLocal}_${range.toLocal}`;
  if (format === 'pdf') {
    await audit(actorFromReq(req), 'report.export_pdf', 'report', key, { range: range.label });
    res.type('application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${fname}.pdf"`);
    return res.send(await reportPdf(data, ctx));
  }
  if (format === 'xlsx') {
    await audit(actorFromReq(req), 'report.export_xlsx', 'report', key, { range: range.label });
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="${fname}.xlsx"`);
    return res.send(await reportXlsx(data, ctx));
  }
  res.json({ data: { ...data, range, currency: r.currency } });
}));

/** Ledger integrity / reconciliation summary for accountants. */
reportsRouter.get('/ledger/health', requirePerm('reports.financial'), ah(async (req, res) => {
  const rid = req.restaurant.id;
  const unbalanced = await unbalancedTransactions(pool, rid);
  const balances = await q<any>('SELECT account, SUM(debit) debit, SUM(credit) credit, SUM(debit-credit) balance FROM ledger_entries WHERE restaurant_id=? GROUP BY account ORDER BY account', [rid]);
  const billCheck = await q<any>(`SELECT COUNT(*) n FROM bills b WHERE b.restaurant_id=? AND b.status='closed' AND b.revenue_posted=1 AND b.total>0
      AND NOT EXISTS (SELECT 1 FROM ledger_entries l WHERE l.restaurant_id=b.restaurant_id AND l.ref_type='bill' AND l.ref_id=b.id)`, [rid]);
  const payCheck = await q<any>(`SELECT COUNT(*) n FROM payments p WHERE p.restaurant_id=? AND p.status IN ('approved','cash_collected')
      AND NOT EXISTS (SELECT 1 FROM ledger_entries l WHERE l.restaurant_id=p.restaurant_id AND l.ref_type='payment' AND l.ref_id=p.id)`, [rid]);
  res.json({ data: { balanced: unbalanced.length === 0, unbalancedTransactions: unbalanced.map((u) => u.txn_id), billsMissingLedger: Number(billCheck[0].n), paymentsMissingLedger: Number(payCheck[0].n), balances } });
}));

reportsRouter.get('/ledger/pnl', requirePerm('reports.financial'), ah(async (req, res) => {
  const r = req.restaurant;
  const range = localRangeToUtc(r.timezone, String(req.query.preset || 'this_month'), req.query.from as string, req.query.to as string);
  res.json({ data: { range, pnl: await profitAndLoss(pool, r.id, range.from, range.to, req.query.branchId ? Number(req.query.branchId) : null) } });
}));
