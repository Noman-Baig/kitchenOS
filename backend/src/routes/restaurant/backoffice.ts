import { Router } from 'express';
import { z } from 'zod';
import { exec, one, q, tx, pool } from '../../lib/db.js';
import { ah, idParam, pageParams, parse } from '../../lib/http.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { actorFromReq, audit } from '../../lib/audit.js';
import { crud, zBool, zDate, zId, zPosMoney, zQty } from '../../lib/crud.js';
import { requirePerm } from '../../middleware/auth.js';
import { D } from '../../lib/money.js';
import { findRecipe, moveStock, perUnitConsumption, receivePurchase, recipeCost } from '../../services/inventory.js';
import { postTxn } from '../../services/ledger.js';
import { checkReservationConflict } from '../../services/reservations.js';
import { notify } from '../../services/notify.js';
import { restaurantSettings } from '../../services/settings.js';
import { recomputeBill } from '../../services/bills.js';

export const backofficeRouter = Router();

/* ------------------------------- Inventory ------------------------------- */
crud(backofficeRouter, {
  path: '/ingredients', table: 'ingredients', entity: 'ingredient', read: 'inventory.view', write: 'inventory.manage', orderBy: 'name', searchable: ['name', 'sku'], softDeleteCol: 'active', refs: { branch_id: 'branches' },
  shape: { name: z.string().min(1).max(160), sku: z.string().max(60).nullable().optional(), unit: z.string().min(1).max(20), min_qty: zQty.optional(), reorder_qty: zQty.nullable().optional(), is_finished_product: zBool.optional(), branch_id: zId.nullable().optional(), active: zBool.optional() },
  hooks: { beforeWrite: async (_req, d, existing) => { if (existing && ('stock_qty' in d || 'avg_cost' in d)) throw badRequest('Use stock adjustments to change quantities'); } },
});
backofficeRouter.get('/inventory/low-stock', requirePerm('inventory.view'), ah(async (req, res) => {
  const rows = await q<any>(`SELECT i.id, i.name, i.unit, i.stock_qty, i.min_qty, i.reorder_qty,
      (SELECT COALESCE(SUM(-m.quantity),0) FROM stock_movements m WHERE m.ingredient_id=i.id AND m.movement_type IN ('sale','complimentary','wastage') AND m.created_at>DATE_SUB(NOW(), INTERVAL 7 DAY)) used_7d
    FROM ingredients i WHERE i.restaurant_id=? AND i.active=1 AND i.min_qty>0 AND i.stock_qty<=i.min_qty ORDER BY i.name`, [req.restaurant.id]);
  res.json({ data: rows.map((r) => {
    const daily = D(r.used_7d).div(7);
    const target = D(r.min_qty).times(2).plus(daily.times(7));
    const required = D(r.min_qty).minus(D(r.stock_qty));
    const suggested = r.reorder_qty ? D(r.reorder_qty) : target.minus(D(r.stock_qty));
    return { ...r, requiredQty: Decimal(required), recentDailyUse: daily.toFixed(4), suggestedRestockQty: Decimal(suggested) };
  }) });
}));
const Decimal = (d: any) => (D(d).lt(0) ? '0.0000' : D(d).toFixed(4));
backofficeRouter.get('/inventory/movements', requirePerm('inventory.view'), ah(async (req, res) => {
  const { page, pageSize, offset } = pageParams(req);
  const w = ['m.restaurant_id=?']; const p: unknown[] = [req.restaurant.id];
  if (req.query.ingredientId) { w.push('m.ingredient_id=?'); p.push(Number(req.query.ingredientId)); }
  if (req.query.type) { w.push('m.movement_type=?'); p.push(String(req.query.type)); }
  res.json({ data: await q(`SELECT m.*, i.name ingredient, i.unit, u.name user_name FROM stock_movements m JOIN ingredients i ON i.id=m.ingredient_id LEFT JOIN users u ON u.id=m.user_id WHERE ${w.join(' AND ')} ORDER BY m.id DESC LIMIT ? OFFSET ?`, [...p, pageSize, offset]), page, pageSize });
}));
backofficeRouter.post('/inventory/adjust', requirePerm('inventory.manage'), ah(async (req, res) => {
  const b = parse(z.object({ ingredientId: zId, mode: z.enum(['delta', 'count', 'opening']), quantity: zQty, unitCost: zPosMoney.optional(), reason: z.string().min(2).max(300) }), req.body);
  const out = await tx(async (db) => {
    const ing = await one<any>('SELECT * FROM ingredients WHERE id=? AND restaurant_id=? FOR UPDATE', [b.ingredientId, req.restaurant.id], db);
    if (!ing) throw notFound('Ingredient');
    const delta = b.mode === 'count' ? D(b.quantity).minus(D(ing.stock_qty)) : D(b.quantity);
    if (delta.isZero()) return { delta: '0' };
    const type = b.mode === 'opening' ? 'opening' : 'adjustment';
    const m = await moveStock(db, { restaurantId: req.restaurant.id, ingredientId: ing.id, qty: delta, type, unitCost: b.unitCost ?? null, refType: 'adjustment', note: b.reason, userId: req.user!.id });
    const value = m.cost.toFixed(4);
    if (D(value).gt(0)) {
      // opening stock → equity; count differences → stock_adjustment (P&L)
      const counter = type === 'opening' ? 'owner_equity' : 'stock_adjustment';
      await postTxn(db, { restaurantId: req.restaurant.id, refType: 'stock_adjustment', refId: ing.id, memo: `${type}: ${ing.name} ${delta.toFixed(4)} (${b.reason})`,
        legs: delta.gt(0) ? [{ account: 'inventory', debit: value }, { account: counter, credit: value }] : [{ account: counter, debit: value }, { account: 'inventory', credit: value }] });
    }
    await audit(actorFromReq(req), 'inventory.adjust', 'ingredient', ing.id, { ...b, delta: delta.toFixed(4) }, db);
    return { delta: delta.toFixed(4), balance: m.balance.toFixed(4) };
  });
  res.json({ data: out });
}));
backofficeRouter.post('/inventory/transfer', requirePerm('inventory.manage'), ah(async (req, res) => {
  const b = parse(z.object({ fromIngredientId: zId, toIngredientId: zId, quantity: zQty, note: z.string().max(300).optional() }), req.body);
  if (b.fromIngredientId === b.toIngredientId) throw badRequest('Choose two different stock items');
  if (D(b.quantity).lte(0)) throw badRequest('Quantity must be positive');
  await tx(async (db) => {
    const from = await one<any>('SELECT * FROM ingredients WHERE id=? AND restaurant_id=? FOR UPDATE', [b.fromIngredientId, req.restaurant.id], db);
    const to = await one<any>('SELECT * FROM ingredients WHERE id=? AND restaurant_id=? FOR UPDATE', [b.toIngredientId, req.restaurant.id], db);
    if (!from || !to) throw notFound('Ingredient');
    if (from.unit !== to.unit) throw badRequest('Units must match for transfers');
    await moveStock(db, { restaurantId: req.restaurant.id, ingredientId: from.id, qty: D(b.quantity).neg(), type: 'transfer_out', refType: 'transfer', refId: to.id, note: b.note, userId: req.user!.id, branchId: from.branch_id });
    await moveStock(db, { restaurantId: req.restaurant.id, ingredientId: to.id, qty: b.quantity, type: 'transfer_in', unitCost: from.avg_cost, refType: 'transfer', refId: from.id, note: `Transfer in: ${b.note || ''}`, userId: req.user!.id, branchId: to.branch_id });
    await audit(actorFromReq(req), 'inventory.transfer', 'ingredient', from.id, b, db);
  });
  res.json({ ok: true });
}));
backofficeRouter.post('/inventory/returns', requirePerm('inventory.manage'), ah(async (req, res) => {
  const b = parse(z.object({ ingredientId: zId, quantity: zQty, refundAmount: zPosMoney, refundedVia: z.enum(['cash', 'bank', 'credit']), note: z.string().max(300) }), req.body);
  await tx(async (db) => {
    const m = await moveStock(db, { restaurantId: req.restaurant.id, ingredientId: b.ingredientId, qty: D(b.quantity).abs().neg(), type: 'return', refType: 'supplier_return', note: b.note, userId: req.user!.id });
    const cost = m.cost; const refund = D(b.refundAmount);
    const legs: any[] = [{ account: b.refundedVia === 'credit' ? 'accounts_payable' : b.refundedVia, debit: refund.toFixed(4) }, { account: 'inventory', credit: cost.toFixed(4) }];
    const diff = refund.minus(cost);
    if (diff.gt(0)) legs.push({ account: 'stock_adjustment', credit: diff.toFixed(4) }); else if (diff.lt(0)) legs.push({ account: 'stock_adjustment', debit: diff.abs().toFixed(4) });
    await postTxn(db, { restaurantId: req.restaurant.id, refType: 'supplier_return', refId: b.ingredientId, memo: `Return to supplier: ${b.note}`, legs });
    await audit(actorFromReq(req), 'inventory.return', 'ingredient', b.ingredientId, b, db);
  });
  res.json({ ok: true });
}));

/* Recipes (BOM) */
backofficeRouter.get('/recipes/:itemId', requirePerm('inventory.view', 'menu.manage'), ah(async (req, res) => {
  const itemId = idParam(req, 'itemId'); const variantId = req.query.variantId ? Number(req.query.variantId) : null;
  const item = await one<any>('SELECT id, name, price FROM menu_items WHERE id=? AND restaurant_id=?', [itemId, req.restaurant.id]);
  if (!item) throw notFound('Menu item');
  const recipe = variantId ? await one<any>('SELECT * FROM recipes WHERE restaurant_id=? AND menu_item_id=? AND variant_id=?', [req.restaurant.id, itemId, variantId]) : await one<any>('SELECT * FROM recipes WHERE restaurant_id=? AND menu_item_id=? AND variant_id IS NULL', [req.restaurant.id, itemId]);
  const lines = recipe ? await q<any>('SELECT rl.*, i.name, i.unit, i.avg_cost FROM recipe_lines rl JOIN ingredients i ON i.id=rl.ingredient_id WHERE rl.recipe_id=?', [recipe.id]) : [];
  const full = recipe ? await findRecipe(pool, req.restaurant.id, itemId, variantId) : null;
  const cost = full ? perUnitConsumption(full).reduce((s, l) => s.plus(l.qty.times(l.unitCost)), D(0)) : null;
  res.json({ data: { item, recipe, lines: lines.map((l) => ({ ...l, line_cost: D(l.quantity).times(D(l.avg_cost)).toFixed(4) })), unitCost: cost?.toFixed(4) ?? null, marginPct: cost && D(item.price).gt(0) ? D(item.price).minus(cost).div(item.price).times(100).toFixed(2) : null } });
}));
backofficeRouter.put('/recipes/:itemId', requirePerm('inventory.manage'), ah(async (req, res) => {
  const itemId = idParam(req, 'itemId');
  const b = parse(z.object({ variantId: zId.nullable().optional(), yieldQty: zQty, wastagePct: zPosMoney, notes: z.string().max(500).nullable().optional(), lines: z.array(z.object({ ingredientId: zId, quantity: zQty, isOptional: z.boolean().optional() })).max(100) }), req.body);
  if (D(b.yieldQty).lte(0)) throw badRequest('Yield must be positive');
  if (!(await one('SELECT id FROM menu_items WHERE id=? AND restaurant_id=?', [itemId, req.restaurant.id]))) throw notFound('Menu item');
  if (b.variantId && !(await one('SELECT id FROM item_variants WHERE id=? AND item_id=? AND restaurant_id=?', [b.variantId, itemId, req.restaurant.id]))) throw badRequest('Invalid variant');
  if (b.lines.length) {
    const ids = [...new Set(b.lines.map((l) => l.ingredientId))];
    const found = await q('SELECT id FROM ingredients WHERE restaurant_id=? AND id IN (?)', [req.restaurant.id, ids]);
    if (found.length !== ids.length) throw badRequest('Unknown ingredient in recipe');
  }
  await tx(async (db) => {
    let recipe = await one<any>(`SELECT id FROM recipes WHERE restaurant_id=? AND menu_item_id=? AND ${b.variantId ? 'variant_id=?' : 'variant_id IS NULL'}`, b.variantId ? [req.restaurant.id, itemId, b.variantId] : [req.restaurant.id, itemId], db);
    if (!recipe) recipe = { id: (await exec('INSERT INTO recipes (restaurant_id, menu_item_id, variant_id, yield_qty, wastage_pct, notes) VALUES (?,?,?,?,?,?)', [req.restaurant.id, itemId, b.variantId ?? null, b.yieldQty, b.wastagePct, b.notes ?? null], db)).insertId };
    else await exec('UPDATE recipes SET yield_qty=?, wastage_pct=?, notes=? WHERE id=?', [b.yieldQty, b.wastagePct, b.notes ?? null, recipe.id], db);
    await exec('DELETE FROM recipe_lines WHERE recipe_id=?', [recipe.id], db);
    if (b.lines.length) await exec('INSERT INTO recipe_lines (restaurant_id, recipe_id, ingredient_id, quantity, is_optional) VALUES ?', [b.lines.map((l) => [req.restaurant.id, recipe.id, l.ingredientId, l.quantity, l.isOptional ? 1 : 0])], db);
    await audit(actorFromReq(req), 'recipe.save', 'menu_item', itemId, b, db);
  });
  res.json({ data: { unitCost: (await recipeCost(pool, req.restaurant.id, itemId, b.variantId ?? null))?.toFixed(4) ?? null } });
}));

crud(backofficeRouter, {
  path: '/suppliers', table: 'suppliers', entity: 'supplier', read: 'inventory.view', write: 'inventory.manage', orderBy: 'name', searchable: ['name'], softDeleteCol: 'active',
  shape: { name: z.string().min(1).max(190), contact_name: z.string().max(190).nullable().optional(), phone: z.string().max(40).nullable().optional(), email: z.string().email().nullable().optional().or(z.literal('')), address: z.string().max(500).nullable().optional(), active: zBool.optional() },
});
backofficeRouter.get('/purchases', requirePerm('inventory.view'), ah(async (req, res) => {
  const { page, pageSize, offset } = pageParams(req);
  res.json({ data: await q('SELECT p.*, s.name supplier_name, u.name created_by_name FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id LEFT JOIN users u ON u.id=p.created_by WHERE p.restaurant_id=? ORDER BY p.purchase_date DESC, p.id DESC LIMIT ? OFFSET ?', [req.restaurant.id, pageSize, offset]), page, pageSize });
}));
backofficeRouter.get('/purchases/:id', requirePerm('inventory.view'), ah(async (req, res) => {
  const p = await one<any>('SELECT p.*, s.name supplier_name FROM purchases p LEFT JOIN suppliers s ON s.id=p.supplier_id WHERE p.id=? AND p.restaurant_id=?', [idParam(req), req.restaurant.id]);
  if (!p) throw notFound('Purchase');
  res.json({ data: { ...p, lines: await q('SELECT pl.*, i.name, i.unit FROM purchase_lines pl JOIN ingredients i ON i.id=pl.ingredient_id WHERE pl.purchase_id=?', [p.id]) } });
}));
backofficeRouter.post('/purchases', requirePerm('inventory.manage'), ah(async (req, res) => {
  const b = parse(z.object({ supplierId: zId.nullable().optional(), branchId: zId.nullable().optional(), reference: z.string().max(80).nullable().optional(), purchaseDate: zDate, extraCharges: zPosMoney.optional(), paidVia: z.enum(['cash', 'bank', 'credit']), notes: z.string().max(500).nullable().optional(), lines: z.array(z.object({ ingredientId: zId, quantity: zQty, unitCost: zPosMoney })).min(1).max(200) }), req.body);
  const ids = [...new Set(b.lines.map((l) => l.ingredientId))];
  const found = await q('SELECT id FROM ingredients WHERE restaurant_id=? AND id IN (?)', [req.restaurant.id, ids]);
  if (found.length !== ids.length) throw badRequest('Unknown ingredient');
  const id = await tx(async (db) => { const pid = await receivePurchase(db, req.restaurant.id, req.user!.id, b); await audit(actorFromReq(req), 'purchase.receive', 'purchase', pid, b, db); return pid; });
  res.status(201).json({ data: { id } });
}));

/* Wastage & complimentary */
backofficeRouter.get('/wastage', requirePerm('wastage.record', 'inventory.view'), ah(async (req, res) => {
  const { page, pageSize, offset } = pageParams(req);
  res.json({ data: await q(`SELECT w.*, i.name ingredient_name, i.unit, mi.name menu_item_name, u.name employee_name, a.name approved_by_name FROM wastage_records w LEFT JOIN ingredients i ON i.id=w.ingredient_id LEFT JOIN menu_items mi ON mi.id=w.menu_item_id
    LEFT JOIN users u ON u.id=w.employee_id LEFT JOIN users a ON a.id=w.approved_by WHERE w.restaurant_id=? ORDER BY w.id DESC LIMIT ? OFFSET ?`, [req.restaurant.id, pageSize, offset]), page, pageSize });
}));
backofficeRouter.post('/wastage', requirePerm('wastage.record'), ah(async (req, res) => {
  const b = parse(z.object({ kind: z.enum(['ingredient', 'prepared_food', 'expired', 'damaged', 'complaint', 'complimentary', 'staff_meal', 'kitchen_testing', 'other']), ingredientId: zId.nullable().optional(), menuItemId: zId.nullable().optional(), quantity: zQty, reason: z.string().min(2).max(500), employeeId: zId.nullable().optional(), occurredAt: z.string().datetime().optional(), branchId: zId.nullable().optional() }), req.body);
  if (!b.ingredientId === !b.menuItemId) throw badRequest('Choose either an ingredient or a prepared menu item');
  if (D(b.quantity).lte(0)) throw badRequest('Quantity must be positive');
  if (b.ingredientId && !(await one('SELECT id FROM ingredients WHERE id=? AND restaurant_id=?', [b.ingredientId, req.restaurant.id]))) throw badRequest('Invalid ingredient');
  if (b.menuItemId && !(await one('SELECT id FROM menu_items WHERE id=? AND restaurant_id=?', [b.menuItemId, req.restaurant.id]))) throw badRequest('Invalid menu item');
  const cost = b.ingredientId ? D((await one<any>('SELECT avg_cost FROM ingredients WHERE id=?', [b.ingredientId])).avg_cost).times(D(b.quantity)) : D((await recipeCost(pool, req.restaurant.id, b.menuItemId!, null)) ?? 0).times(D(b.quantity));
  const r = await exec('INSERT INTO wastage_records (restaurant_id, branch_id, kind, ingredient_id, menu_item_id, quantity, cost, reason, employee_id, occurred_at, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [req.restaurant.id, b.branchId ?? null, b.kind, b.ingredientId ?? null, b.menuItemId ?? null, b.quantity, cost.toFixed(4), b.reason, b.employeeId ?? req.user!.id, b.occurredAt ? new Date(b.occurredAt) : new Date(), req.user!.id]);
  await notify({ restaurantId: req.restaurant.id, type: 'wastage_pending', permission: 'wastage.approve', title: 'Wastage awaiting approval', body: `${b.kind}: ${b.reason}`, data: { wastageId: r.insertId } });
  res.status(201).json({ data: { id: r.insertId, estimatedCost: cost.toFixed(4) } });
}));
/** Approval deducts stock and posts cost: wastage → `wastage`; complimentary/staff meals → `complimentary_cost`. */
backofficeRouter.post('/wastage/:id/:decision(approve|reject)', requirePerm('wastage.approve'), ah(async (req, res) => {
  await tx(async (db) => {
    const w = await one<any>('SELECT * FROM wastage_records WHERE id=? AND restaurant_id=? FOR UPDATE', [idParam(req), req.restaurant.id], db);
    if (!w) throw notFound('Wastage record');
    if (w.status !== 'pending') throw conflict(`Already ${w.status}`);
    if (req.params.decision === 'reject') { await exec("UPDATE wastage_records SET status='rejected', approved_by=?, approved_at=NOW(3) WHERE id=?", [req.user!.id, w.id], db); return; }
    let total = D(0);
    const consume = async (ingredientId: number, qty: any) => { const m = await moveStock(db, { restaurantId: req.restaurant.id, ingredientId, qty: D(qty).neg(), type: 'wastage', refType: 'wastage', refId: w.id, note: w.reason, userId: req.user!.id, branchId: w.branch_id }); total = total.plus(m.cost); };
    if (w.ingredient_id) await consume(w.ingredient_id, w.quantity);
    else { const r = await findRecipe(db, req.restaurant.id, w.menu_item_id, null); if (r) for (const l of perUnitConsumption(r)) await consume(l.ingredientId, l.qty.times(D(w.quantity))); }
    const account = ['complimentary', 'staff_meal'].includes(w.kind) ? 'complimentary_cost' : 'wastage';
    if (total.gt(0)) await postTxn(db, { restaurantId: req.restaurant.id, branchId: w.branch_id, refType: 'wastage', refId: w.id, memo: `${w.kind}: ${w.reason}`, legs: [{ account, debit: total.toFixed(4) }, { account: 'inventory', credit: total.toFixed(4) }] });
    await exec("UPDATE wastage_records SET status='approved', cost=?, approved_by=?, approved_at=NOW(3) WHERE id=?", [total.toFixed(4), req.user!.id, w.id], db);
    await audit(actorFromReq(req), 'wastage.approve', 'wastage', w.id, { cost: total.toFixed(4) }, db);
  });
  res.json({ ok: true });
}));

/* ------------------------------- Expenses & payroll ------------------------------- */
const expenseCategories = ['rent', 'electricity', 'water', 'gas', 'salaries', 'purchases', 'repairs', 'marketing', 'delivery', 'maintenance', 'other'] as const;
backofficeRouter.get('/expenses', requirePerm('expenses.manage'), ah(async (req, res) => {
  const { page, pageSize, offset } = pageParams(req);
  const w = ['e.restaurant_id=?']; const p: unknown[] = [req.restaurant.id];
  if (req.query.category) { w.push('e.category=?'); p.push(String(req.query.category)); }
  if (req.query.from) { w.push('e.expense_date>=?'); p.push(String(req.query.from)); }
  if (req.query.to) { w.push('e.expense_date<=?'); p.push(String(req.query.to)); }
  res.json({ data: await q(`SELECT e.*, b.name branch_name FROM expenses e LEFT JOIN branches b ON b.id=e.branch_id WHERE ${w.join(' AND ')} ORDER BY e.expense_date DESC, e.id DESC LIMIT ? OFFSET ?`, [...p, pageSize, offset]), page, pageSize });
}));
export async function createExpense(db: any, restaurantId: number, userId: number | null, e: { category: string; amount: string; expenseDate: string; description?: string | null; paidVia: 'cash' | 'bank'; branchId?: number | null; recurringId?: number | null }) {
  const r = await exec('INSERT INTO expenses (restaurant_id, branch_id, category, amount, expense_date, description, paid_via, recurring_id, created_by) VALUES (?,?,?,?,?,?,?,?,?)', [restaurantId, e.branchId ?? null, e.category, e.amount, e.expenseDate, e.description ?? null, e.paidVia, e.recurringId ?? null, userId], db);
  await postTxn(db, { restaurantId, branchId: e.branchId, refType: 'expense', refId: r.insertId, memo: `${e.category}: ${e.description || ''}`, at: new Date(`${e.expenseDate}T12:00:00Z`), legs: [{ account: `opex_${e.category}`, debit: e.amount }, { account: e.paidVia, credit: e.amount }] });
  return r.insertId;
}
backofficeRouter.post('/expenses', requirePerm('expenses.manage'), ah(async (req, res) => {
  const b = parse(z.object({ category: z.enum(expenseCategories), amount: zPosMoney, expenseDate: zDate, description: z.string().max(500).nullable().optional(), paidVia: z.enum(['cash', 'bank']), branchId: zId.nullable().optional() }), req.body);
  if (D(b.amount).lte(0)) throw badRequest('Amount must be positive');
  if (b.branchId && !(await one('SELECT id FROM branches WHERE id=? AND restaurant_id=?', [b.branchId, req.restaurant.id]))) throw badRequest('Invalid branch');
  const id = await tx(async (db) => { const i = await createExpense(db, req.restaurant.id, req.user!.id, b); await audit(actorFromReq(req), 'expense.create', 'expense', i, b, db); return i; });
  res.status(201).json({ data: { id } });
}));
backofficeRouter.delete('/expenses/:id', requirePerm('expenses.manage'), ah(async (req, res) => {
  await tx(async (db) => {
    const e = await one<any>('SELECT * FROM expenses WHERE id=? AND restaurant_id=? FOR UPDATE', [idParam(req), req.restaurant.id], db);
    if (!e) throw notFound('Expense');
    const { reverseRef } = await import('../../services/ledger.js');
    await reverseRef(db, req.restaurant.id, 'expense', e.id, `Expense #${e.id} deleted`);
    await exec('DELETE FROM expenses WHERE id=?', [e.id], db);
    await audit(actorFromReq(req), 'expense.delete', 'expense', e.id, e, db);
  });
  res.json({ ok: true });
}));
crud(backofficeRouter, {
  path: '/recurring-expenses', table: 'recurring_expenses', entity: 'recurring_expense', read: 'expenses.manage', write: 'expenses.manage', orderBy: 'next_run_date', refs: { branch_id: 'branches' },
  shape: { category: z.enum(expenseCategories), amount: zPosMoney, description: z.string().max(500).nullable().optional(), frequency: z.enum(['weekly', 'monthly']), next_run_date: zDate, paid_via: z.enum(['cash', 'bank']), active: zBool.optional(), branch_id: zId.nullable().optional() },
});

backofficeRouter.get('/payroll', requirePerm('payroll.manage'), ah(async (req, res) => {
  const w = ['p.restaurant_id=?']; const pr: unknown[] = [req.restaurant.id];
  if (req.query.periodStart) { w.push('p.period_start=?'); pr.push(String(req.query.periodStart)); }
  if (req.query.userId) { w.push('p.user_id=?'); pr.push(Number(req.query.userId)); }
  res.json({ data: await q(`SELECT p.*, u.name employee FROM payroll_entries p JOIN users u ON u.id=p.user_id WHERE ${w.join(' AND ')} ORDER BY p.period_start DESC, u.name LIMIT 500`, pr) });
}));
export async function generatePayroll(db: any, restaurantId: number, periodStart: string, periodEnd: string) {
  const staff = await q<any>("SELECT id, salary FROM users WHERE restaurant_id=? AND active=1 AND salary IS NOT NULL AND salary>0 AND pay_frequency='monthly'", [restaurantId], db);
  let created = 0;
  for (const s of staff) {
    const r = await exec('INSERT IGNORE INTO payroll_entries (restaurant_id, user_id, period_start, period_end, base_salary, net_pay) VALUES (?,?,?,?,?,?)', [restaurantId, s.id, periodStart, periodEnd, s.salary, s.salary], db);
    created += r.affectedRows;
  }
  return created;
}
backofficeRouter.post('/payroll/generate', requirePerm('payroll.manage'), ah(async (req, res) => {
  const b = parse(z.object({ periodStart: zDate, periodEnd: zDate }), req.body);
  if (b.periodEnd < b.periodStart) throw badRequest('Period end must be after start');
  const n = await generatePayroll(pool, req.restaurant.id, b.periodStart, b.periodEnd);
  await audit(actorFromReq(req), 'payroll.generate', 'payroll', null, { ...b, created: n });
  res.json({ data: { created: n } });
}));
backofficeRouter.post('/payroll', requirePerm('payroll.manage'), ah(async (req, res) => {
  const b = parse(z.object({ userId: zId, periodStart: zDate, periodEnd: zDate, baseSalary: zPosMoney }), req.body);
  if (!(await one('SELECT id FROM users WHERE id=? AND restaurant_id=?', [b.userId, req.restaurant.id]))) throw badRequest('Invalid employee');
  const r = await exec('INSERT INTO payroll_entries (restaurant_id, user_id, period_start, period_end, base_salary, net_pay) VALUES (?,?,?,?,?,?)', [req.restaurant.id, b.userId, b.periodStart, b.periodEnd, b.baseSalary, b.baseSalary]);
  res.status(201).json({ data: { id: r.insertId } });
}));
backofficeRouter.patch('/payroll/:id', requirePerm('payroll.manage'), ah(async (req, res) => {
  const b = parse(z.object({ bonuses: zPosMoney, deductions: zPosMoney, advances: zPosMoney, baseSalary: zPosMoney, notes: z.string().max(500).nullable() }).partial(), req.body);
  await tx(async (db) => {
    const p = await one<any>('SELECT * FROM payroll_entries WHERE id=? AND restaurant_id=? FOR UPDATE', [idParam(req), req.restaurant.id], db);
    if (!p) throw notFound('Payroll entry');
    if (p.status === 'paid') throw conflict('Paid entries cannot be edited');
    const base = D(b.baseSalary ?? p.base_salary), bon = D(b.bonuses ?? p.bonuses), ded = D(b.deductions ?? p.deductions), adv = D(b.advances ?? p.advances);
    const net = base.plus(bon).minus(ded).minus(adv);
    if (net.lt(0)) throw badRequest('Net pay cannot be negative');
    await exec('UPDATE payroll_entries SET base_salary=?, bonuses=?, deductions=?, advances=?, net_pay=?, notes=? WHERE id=?', [base.toFixed(4), bon.toFixed(4), ded.toFixed(4), adv.toFixed(4), net.toFixed(4), b.notes ?? p.notes, p.id], db);
    await audit(actorFromReq(req), 'payroll.update', 'payroll', p.id, b, db);
  });
  res.json({ ok: true });
}));
/** Advances are paid out immediately (cash/bank) and deducted from the period's net pay. */
backofficeRouter.post('/payroll/:id/advance', requirePerm('payroll.manage'), ah(async (req, res) => {
  const b = parse(z.object({ amount: zPosMoney, paidVia: z.enum(['cash', 'bank']) }), req.body);
  await tx(async (db) => {
    const p = await one<any>('SELECT * FROM payroll_entries WHERE id=? AND restaurant_id=? FOR UPDATE', [idParam(req), req.restaurant.id], db);
    if (!p) throw notFound('Payroll entry');
    if (p.status === 'paid') throw conflict('Already paid');
    const adv = D(p.advances).plus(D(b.amount)); const net = D(p.base_salary).plus(D(p.bonuses)).minus(D(p.deductions)).minus(adv);
    if (net.lt(0)) throw badRequest('Advance exceeds remaining pay');
    await exec('UPDATE payroll_entries SET advances=?, net_pay=? WHERE id=?', [adv.toFixed(4), net.toFixed(4), p.id], db);
    await postTxn(db, { restaurantId: req.restaurant.id, refType: 'payroll_advance', refId: p.id, memo: 'Salary advance', legs: [{ account: 'payroll', debit: b.amount }, { account: b.paidVia, credit: b.amount }] });
    await audit(actorFromReq(req), 'payroll.advance', 'payroll', p.id, b, db);
  });
  res.json({ ok: true });
}));
backofficeRouter.post('/payroll/:id/pay', requirePerm('payroll.manage'), ah(async (req, res) => {
  const b = parse(z.object({ paidVia: z.enum(['cash', 'bank']) }), req.body);
  await tx(async (db) => {
    const p = await one<any>('SELECT * FROM payroll_entries WHERE id=? AND restaurant_id=? FOR UPDATE', [idParam(req), req.restaurant.id], db);
    if (!p) throw notFound('Payroll entry');
    if (p.status === 'paid') throw conflict('Already paid');
    await exec("UPDATE payroll_entries SET status='paid', paid_via=?, paid_at=NOW(3) WHERE id=?", [b.paidVia, p.id], db);
    if (D(p.net_pay).gt(0)) await postTxn(db, { restaurantId: req.restaurant.id, refType: 'payroll', refId: p.id, memo: `Payroll ${p.period_start}`, legs: [{ account: 'payroll', debit: p.net_pay }, { account: b.paidVia, credit: p.net_pay }] });
    await audit(actorFromReq(req), 'payroll.pay', 'payroll', p.id, { netPay: p.net_pay, paidVia: b.paidVia }, db);
  });
  res.json({ ok: true });
}));

/* ------------------------------- Customers, loyalty, coupons ------------------------------- */
crud(backofficeRouter, {
  path: '/customers', table: 'customers', entity: 'customer', read: 'customers.manage', write: 'customers.manage', orderBy: 'last_visit_at DESC, id DESC', searchable: ['name', 'phone', 'email'], noDelete: true,
  shape: { name: z.string().min(1).max(190), phone: z.string().max(40).nullable().optional(), email: z.string().email().nullable().optional().or(z.literal('')), birthday: zDate.nullable().optional(), marketing_opt_in: zBool.optional(), recognition_opt_in: zBool.optional(), notes: z.string().max(1000).nullable().optional() },
});
backofficeRouter.get('/customers/:id/history', requirePerm('customers.manage'), ah(async (req, res) => {
  const id = idParam(req);
  const c = await one('SELECT * FROM customers WHERE id=? AND restaurant_id=?', [id, req.restaurant.id]);
  if (!c) throw notFound('Customer');
  const [bills, points, fb] = await Promise.all([
    q('SELECT id, bill_no, total, status, channel, opened_at, closed_at FROM bills WHERE customer_id=? AND restaurant_id=? ORDER BY id DESC LIMIT 100', [id, req.restaurant.id]),
    q('SELECT * FROM loyalty_transactions WHERE customer_id=? AND restaurant_id=? ORDER BY id DESC LIMIT 100', [id, req.restaurant.id]),
    q('SELECT rating, comment, created_at FROM feedback WHERE customer_id=? AND restaurant_id=? ORDER BY id DESC LIMIT 50', [id, req.restaurant.id]),
  ]);
  res.json({ data: { customer: c, bills, loyalty: points, feedback: fb } });
}));
/** Customer data erasure on request (privacy): anonymises the profile but keeps financial records intact. */
backofficeRouter.post('/customers/:id/anonymize', requirePerm('customers.manage'), ah(async (req, res) => {
  const id = idParam(req);
  const r = await exec("UPDATE customers SET name='Deleted customer', phone=NULL, email=NULL, birthday=NULL, marketing_opt_in=0, recognition_opt_in=0, notes=NULL WHERE id=? AND restaurant_id=?", [id, req.restaurant.id]);
  if (!r.affectedRows) throw notFound('Customer');
  await exec("UPDATE customer_sessions SET customer_phone=NULL, customer_name='Guest' WHERE customer_id=? AND restaurant_id=?", [id, req.restaurant.id]);
  await audit(actorFromReq(req), 'customer.anonymize', 'customer', id);
  res.json({ ok: true });
}));
backofficeRouter.post('/customers/:id/loyalty', requirePerm('loyalty.manage'), ah(async (req, res) => {
  const b = parse(z.object({ points: z.number().int().min(-1000000).max(1000000).refine((n) => n !== 0), reason: z.string().min(2).max(120), billId: zId.nullable().optional() }), req.body);
  await tx(async (db) => {
    const c = await one<any>('SELECT * FROM customers WHERE id=? AND restaurant_id=? FOR UPDATE', [idParam(req), req.restaurant.id], db);
    if (!c) throw notFound('Customer');
    if (c.loyalty_points + b.points < 0) throw badRequest('Insufficient points');
    if (b.points < 0 && b.billId) {
      // redemption applied as a discount on an open bill
      const s = restaurantSettings(req.restaurant).loyalty;
      if (-b.points < s.minRedeemPoints) throw badRequest(`Minimum redemption is ${s.minRedeemPoints} points`);
      const bill = await one<any>("SELECT * FROM bills WHERE id=? AND restaurant_id=? AND status='open' FOR UPDATE", [b.billId, req.restaurant.id], db);
      if (!bill) throw badRequest('Bill is not open');
      const value = D(-b.points).times(D(s.redeemValuePerPoint));
      await exec('UPDATE bills SET discount=?, customer_id=? WHERE id=?', [JSON.stringify({ type: 'fixed', value: value.toFixed(4), source: 'loyalty', points: -b.points }), c.id, bill.id], db);
      await recomputeBill(db, req.restaurant.id, bill.id);
    }
    await exec('INSERT INTO loyalty_transactions (restaurant_id, customer_id, points, reason, bill_id, created_by) VALUES (?,?,?,?,?,?)', [req.restaurant.id, c.id, b.points, b.reason, b.billId ?? null, req.user!.id], db);
    await exec('UPDATE customers SET loyalty_points=loyalty_points+? WHERE id=?', [b.points, c.id], db);
    await audit(actorFromReq(req), 'loyalty.adjust', 'customer', c.id, b, db);
  });
  res.json({ ok: true });
}));
crud(backofficeRouter, {
  path: '/coupons', table: 'coupons', entity: 'coupon', read: 'loyalty.manage', write: 'loyalty.manage', orderBy: 'id DESC', searchable: ['code'],
  shape: { code: z.string().min(3).max(40).regex(/^[A-Za-z0-9_-]+$/).transform((s) => s.toUpperCase()), description: z.string().max(300).nullable().optional(), discount_type: z.enum(['percent', 'fixed']), value: zPosMoney, min_order: zPosMoney.optional(), max_uses: z.number().int().positive().nullable().optional(), starts_at: z.string().datetime().nullable().optional().transform((v) => (v ? new Date(v) : v)), ends_at: z.string().datetime().nullable().optional().transform((v) => (v ? new Date(v) : v)), birthday_only: zBool.optional(), active: zBool.optional() },
  hooks: { beforeWrite: async (_r, d) => { if (d.discount_type === 'percent' && d.value && D(d.value as string).gt(100)) throw badRequest('Percent cannot exceed 100'); } },
});
backofficeRouter.get('/marketing/audience', requirePerm('loyalty.manage'), ah(async (req, res) => {
  // only customers who explicitly opted in; never includes opted-out contacts
  res.json({ data: await q('SELECT id, name, phone, email, birthday, last_visit_at, marketing_opt_in_at FROM customers WHERE restaurant_id=? AND marketing_opt_in=1 ORDER BY last_visit_at DESC LIMIT 5000', [req.restaurant.id]) });
}));

/* ------------------------------- Reservations & waitlist ------------------------------- */
backofficeRouter.get('/reservations', requirePerm('reservations.manage'), ah(async (req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 86400000);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date(Date.now() + 30 * 86400000);
  res.json({ data: await q('SELECT r.*, t.name table_name FROM reservations r LEFT JOIN dining_tables t ON t.id=r.table_id WHERE r.restaurant_id=? AND r.reserved_for BETWEEN ? AND ? ORDER BY r.reserved_for', [req.restaurant.id, from, to]) });
}));
const resShape = z.object({ customerName: z.string().min(1).max(190), phone: z.string().max(40).nullable().optional(), email: z.string().email().nullable().optional().or(z.literal('')), partySize: z.number().int().min(1).max(500), reservedFor: z.string().datetime(), durationMinutes: z.number().int().min(15).max(600).optional(), tableId: zId.nullable().optional(), specialRequests: z.string().max(1000).nullable().optional(), status: z.enum(['requested', 'confirmed', 'rejected', 'cancelled', 'arrived', 'completed', 'no_show']).optional(), source: z.enum(['online', 'staff', 'phone']).optional(), branchId: zId.nullable().optional() });
async function validateReservation(req: any, b: any, excludeId: number | null) {
  if (b.tableId) {
    const t = await one<any>('SELECT * FROM dining_tables WHERE id=? AND restaurant_id=? AND active=1', [b.tableId, req.restaurant.id]);
    if (!t) throw badRequest('Invalid table');
    if (b.partySize && b.partySize > t.capacity) throw badRequest(`Table seats ${t.capacity}`);
    const conflictRow = await checkReservationConflict(pool, req.restaurant.id, b.tableId, new Date(b.reservedFor), b.durationMinutes ?? 90, restaurantSettings(req.restaurant).reservationSeatingBufferMinutes, excludeId);
    if (conflictRow) throw conflict(`Table already reserved for ${conflictRow.customer_name} at ${new Date(conflictRow.reserved_for).toISOString()}`);
  }
}
backofficeRouter.post('/reservations', requirePerm('reservations.manage'), ah(async (req, res) => {
  const b = parse(resShape, req.body);
  await validateReservation(req, b, null);
  const r = await exec('INSERT INTO reservations (restaurant_id, branch_id, customer_name, phone, email, party_size, reserved_for, duration_minutes, table_id, status, special_requests, source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    [req.restaurant.id, b.branchId ?? null, b.customerName, b.phone ?? null, b.email || null, b.partySize, new Date(b.reservedFor), b.durationMinutes ?? 90, b.tableId ?? null, b.status ?? 'confirmed', b.specialRequests ?? null, b.source ?? 'staff']);
  await audit(actorFromReq(req), 'reservation.create', 'reservation', r.insertId, b);
  res.status(201).json({ data: { id: r.insertId } });
}));
backofficeRouter.patch('/reservations/:id', requirePerm('reservations.manage'), ah(async (req, res) => {
  const id = idParam(req);
  const cur = await one<any>('SELECT * FROM reservations WHERE id=? AND restaurant_id=?', [id, req.restaurant.id]);
  if (!cur) throw notFound('Reservation');
  const b = parse(resShape.partial(), req.body);
  const merged = { tableId: b.tableId !== undefined ? b.tableId : cur.table_id, reservedFor: b.reservedFor ?? new Date(cur.reserved_for).toISOString(), durationMinutes: b.durationMinutes ?? cur.duration_minutes, partySize: b.partySize ?? cur.party_size };
  if (!['cancelled', 'rejected', 'no_show', 'completed'].includes(b.status ?? cur.status)) await validateReservation(req, merged, id);
  const map: Record<string, string> = { customerName: 'customer_name', phone: 'phone', email: 'email', partySize: 'party_size', reservedFor: 'reserved_for', durationMinutes: 'duration_minutes', tableId: 'table_id', specialRequests: 'special_requests', status: 'status', branchId: 'branch_id' };
  const sets: string[] = []; const vals: unknown[] = [];
  for (const [k, v] of Object.entries(b)) if (map[k]) { sets.push(`${map[k]}=?`); vals.push(k === 'reservedFor' ? new Date(v as string) : v); }
  if (b.reservedFor) sets.push('reminded=0');
  if (sets.length) await exec(`UPDATE reservations SET ${sets.join(',')} WHERE id=?`, [...vals, id]);
  await audit(actorFromReq(req), 'reservation.update', 'reservation', id, b);
  res.json({ ok: true });
}));
crud(backofficeRouter, {
  path: '/waitlist', table: 'waitlist', entity: 'waitlist', read: 'reservations.manage', write: 'reservations.manage', orderBy: "status='waiting' DESC, id",
  shape: { customer_name: z.string().min(1).max(190), phone: z.string().max(40).nullable().optional(), party_size: z.number().int().min(1).max(100), status: z.enum(['waiting', 'notified', 'seated', 'left']).optional(), notes: z.string().max(300).nullable().optional() },
});

/* ------------------------------- Feedback ------------------------------- */
backofficeRouter.get('/feedback', requirePerm('feedback.manage'), ah(async (req, res) => {
  const w = ['f.restaurant_id=?']; const p: unknown[] = [req.restaurant.id];
  if (req.query.rating) { w.push('f.rating=?'); p.push(Number(req.query.rating)); }
  if (req.query.status) { w.push('f.status=?'); p.push(String(req.query.status)); }
  if (req.query.complaints === '1') w.push('f.is_complaint=1');
  if (req.query.from) { w.push('f.created_at>=?'); p.push(new Date(String(req.query.from))); }
  if (req.query.to) { w.push('f.created_at<?'); p.push(new Date(String(req.query.to))); }
  const rows = await q(`SELECT f.*, o.order_no, u.name resolved_by_name FROM feedback f LEFT JOIN orders o ON o.id=f.order_id LEFT JOIN users u ON u.id=f.resolved_by WHERE ${w.join(' AND ')} ORDER BY f.id DESC LIMIT 500`, p);
  const stats = await one('SELECT COUNT(*) n, AVG(rating) avg_rating, AVG(food_rating) avg_food, AVG(service_rating) avg_service, SUM(is_complaint) complaints, SUM(is_complaint AND status=\'open\') open_complaints FROM feedback WHERE restaurant_id=?', [req.restaurant.id]);
  res.json({ data: rows, stats });
}));
backofficeRouter.patch('/feedback/:id', requirePerm('feedback.manage'), ah(async (req, res) => {
  const b = parse(z.object({ status: z.enum(['open', 'resolved']).optional(), internalNote: z.string().max(2000).nullable().optional(), isPublished: z.boolean().optional() }), req.body);
  const f = await one<any>('SELECT * FROM feedback WHERE id=? AND restaurant_id=?', [idParam(req), req.restaurant.id]);
  if (!f) throw notFound('Feedback');
  if (b.isPublished && !f.publish_permission) throw conflict('The customer did not give permission to publish this feedback');
  await exec('UPDATE feedback SET status=COALESCE(?, status), internal_note=COALESCE(?, internal_note), is_published=COALESCE(?, is_published), resolved_by=IF(?=\'resolved\', ?, resolved_by) WHERE id=?',
    [b.status ?? null, b.internalNote ?? null, b.isPublished === undefined ? null : b.isPublished ? 1 : 0, b.status ?? '', req.user!.id, f.id]);
  await audit(actorFromReq(req), 'feedback.update', 'feedback', f.id, b);
  res.json({ ok: true });
}));
