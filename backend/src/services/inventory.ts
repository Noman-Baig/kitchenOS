import { exec, j, one, q, type Db } from '../lib/db.js';
import { D, Decimal } from '../lib/money.js';
import { badRequest, notFound } from '../lib/errors.js';
import { postTxn } from './ledger.js';
import { notify } from './notify.js';
import { emit, rooms } from '../realtime/bus.js';

type MovementType = 'purchase' | 'sale' | 'sale_reversal' | 'adjustment' | 'wastage' | 'transfer_in' | 'transfer_out' | 'return' | 'complimentary' | 'opening';

/**
 * Atomically move stock for one ingredient (row-locked). Positive qty = stock in.
 * Purchases update the weighted-average cost. Returns the movement's cost value (qty × unit cost, absolute).
 */
export async function moveStock(db: Db, p: {
  restaurantId: number; ingredientId: number; qty: Decimal.Value; type: MovementType; unitCost?: Decimal.Value | null;
  refType?: string; refId?: number | null; note?: string | null; userId?: number | null; branchId?: number | null;
}) {
  const ing = await one<any>('SELECT * FROM ingredients WHERE id=? AND restaurant_id=? FOR UPDATE', [p.ingredientId, p.restaurantId], db);
  if (!ing) throw notFound('Ingredient');
  const qty = D(p.qty);
  const before = D(ing.stock_qty);
  const after = before.plus(qty);
  let avg = D(ing.avg_cost);
  const unitCost = p.unitCost !== undefined && p.unitCost !== null ? D(p.unitCost) : avg;
  if ((p.type === 'purchase' || p.type === 'opening' || p.type === 'transfer_in') && qty.gt(0)) {
    const positiveBefore = Decimal.max(before, 0);
    const denom = positiveBefore.plus(qty);
    avg = denom.gt(0) ? positiveBefore.times(avg).plus(qty.times(unitCost)).div(denom) : unitCost;
  }
  const minQty = D(ing.min_qty);
  const isLow = after.lte(minQty) && minQty.gt(0);
  await exec('UPDATE ingredients SET stock_qty=?, avg_cost=?, low_alerted=? WHERE id=?',
    [after.toFixed(4), avg.toFixed(6), isLow ? 1 : 0, ing.id], db);
  await exec(
    'INSERT INTO stock_movements (restaurant_id, branch_id, ingredient_id, movement_type, quantity, unit_cost, balance_after, ref_type, ref_id, note, user_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
    [p.restaurantId, p.branchId ?? null, ing.id, p.type, qty.toFixed(4), unitCost.toFixed(6), after.toFixed(4), p.refType ?? null, p.refId ?? null, p.note ?? null, p.userId ?? null], db);
  if (isLow && !ing.low_alerted) {
    await notify({
      restaurantId: p.restaurantId, type: 'low_stock', permission: 'inventory.view',
      title: `Low stock: ${ing.name}`,
      body: `${ing.name} is at ${after.toDecimalPlaces(2)} ${ing.unit} (minimum ${minQty.toDecimalPlaces(2)} ${ing.unit}).`,
      data: { ingredientId: ing.id },
    }, db);
    emit(rooms.staffPerm(p.restaurantId, 'inventory.view'), 'inventory:low', { ingredientId: ing.id, name: ing.name, stock: after.toFixed(4) });
  }
  return { cost: qty.abs().times(unitCost), balance: after, ingredient: ing };
}

export async function findRecipe(db: Db, restaurantId: number, itemId: number, variantId: number | null) {
  let recipe = variantId
    ? await one<any>('SELECT * FROM recipes WHERE restaurant_id=? AND menu_item_id=? AND variant_id=?', [restaurantId, itemId, variantId], db)
    : null;
  if (!recipe) recipe = await one<any>('SELECT * FROM recipes WHERE restaurant_id=? AND menu_item_id=? AND variant_id IS NULL', [restaurantId, itemId], db);
  if (!recipe) return null;
  const lines = await q<any>('SELECT rl.*, i.avg_cost, i.name ingredient_name, i.unit FROM recipe_lines rl JOIN ingredients i ON i.id=rl.ingredient_id WHERE rl.recipe_id=? AND rl.restaurant_id=?', [recipe.id, restaurantId], db);
  return { ...recipe, lines };
}

/** Ingredient quantities consumed by ONE unit of a menu item (after yield and wastage allowance). */
export function perUnitConsumption(recipe: { yield_qty: string; wastage_pct: string; lines: any[] }, includeOptional = true) {
  const yieldQty = D(recipe.yield_qty).gt(0) ? D(recipe.yield_qty) : D(1);
  const factor = D(1).plus(D(recipe.wastage_pct).div(100)).div(yieldQty);
  return recipe.lines
    .filter((l) => includeOptional || !l.is_optional)
    .map((l) => ({ ingredientId: Number(l.ingredient_id), qty: D(l.quantity).times(factor), unitCost: D(l.avg_cost), name: l.ingredient_name, unit: l.unit }));
}

export async function recipeCost(db: Db, restaurantId: number, itemId: number, variantId: number | null) {
  const r = await findRecipe(db, restaurantId, itemId, variantId);
  if (!r) return null;
  return perUnitConsumption(r).reduce((s, l) => s.plus(l.qty.times(l.unitCost)), D(0));
}

/** Deduct recipe ingredients for every not-yet-deducted, non-cancelled line of an order. Idempotent per line. */
export async function deductForOrder(db: Db, restaurantId: number, orderId: number, userId: number | null) {
  const order = await one<any>('SELECT id, branch_id, order_no FROM orders WHERE id=? AND restaurant_id=?', [orderId, restaurantId], db);
  if (!order) return;
  const items = await q<any>("SELECT * FROM order_items WHERE order_id=? AND restaurant_id=? AND stock_deducted=0 AND status<>'cancelled' FOR UPDATE", [orderId, restaurantId], db);
  for (const it of items) {
    const recipe = await findRecipe(db, restaurantId, it.menu_item_id, it.variant_id);
    const consumption = recipe ? perUnitConsumption(recipe) : [];
    for (const a of j<any[]>(it.addons, [])) {
      if (a.ingredientId && a.ingredientQty) consumption.push({ ingredientId: Number(a.ingredientId), qty: D(a.ingredientQty), unitCost: D(0), name: a.name, unit: '' });
    }
    let cost = D(0);
    for (const c of consumption) {
      const m = await moveStock(db, {
        restaurantId, ingredientId: c.ingredientId, qty: c.qty.times(it.quantity).neg(), type: it.is_complimentary ? 'complimentary' : 'sale',
        refType: 'order_item', refId: it.id, note: `Order ${order.order_no}`, userId, branchId: order.branch_id,
      });
      cost = cost.plus(m.cost);
    }
    if (cost.gt(0)) {
      await postTxn(db, {
        restaurantId, branchId: order.branch_id, refType: 'order_item_cogs', refId: it.id, memo: `COGS ${it.name} ×${it.quantity} (order ${order.order_no})`,
        legs: [{ account: it.is_complimentary ? 'complimentary_cost' : 'cogs', debit: cost.toFixed(4) }, { account: 'inventory', credit: cost.toFixed(4) }],
      });
    }
    await exec('UPDATE order_items SET stock_deducted=1 WHERE id=?', [it.id], db);
  }
  await exec('UPDATE orders SET stock_deducted=1 WHERE id=?', [orderId], db);
}

/** Return stock (and reverse COGS) for deducted lines of an order — used on cancellation, rejection or refund-with-restock. */
export async function reverseForItems(db: Db, restaurantId: number, itemIds: number[], userId: number | null, reason: string) {
  if (!itemIds.length) return;
  const items = await q<any>('SELECT * FROM order_items WHERE id IN (?) AND restaurant_id=? AND stock_deducted=1 FOR UPDATE', [itemIds, restaurantId], db);
  for (const it of items) {
    const moves = await q<any>("SELECT ingredient_id, SUM(quantity) qty, SUM(quantity*unit_cost) value FROM stock_movements WHERE restaurant_id=? AND ref_type='order_item' AND ref_id=? GROUP BY ingredient_id", [restaurantId, it.id], db);
    let cost = D(0);
    for (const m of moves) {
      const qty = D(m.qty).neg(); // original was negative
      if (qty.lte(0)) continue;
      const unit = D(m.value).neg().div(qty);
      await moveStock(db, { restaurantId, ingredientId: m.ingredient_id, qty, type: 'sale_reversal', unitCost: unit, refType: 'order_item_reversal', refId: it.id, note: reason, userId });
      cost = cost.plus(qty.times(unit));
    }
    if (cost.gt(0)) {
      await postTxn(db, {
        restaurantId, refType: 'order_item_cogs_reversal', refId: it.id, memo: `Stock returned: ${it.name} (${reason})`,
        legs: [{ account: 'inventory', debit: cost.toFixed(4) }, { account: it.is_complimentary ? 'complimentary_cost' : 'cogs', credit: cost.toFixed(4) }],
      });
    }
    await exec('UPDATE order_items SET stock_deducted=0 WHERE id=?', [it.id], db);
  }
}

export async function receivePurchase(db: Db, restaurantId: number, userId: number, input: {
  supplierId?: number | null; branchId?: number | null; reference?: string | null; purchaseDate: string; extraCharges?: string; paidVia: 'cash' | 'bank' | 'credit'; notes?: string | null;
  lines: { ingredientId: number; quantity: string; unitCost: string }[];
}) {
  if (!input.lines.length) throw badRequest('A purchase needs at least one line');
  if (input.supplierId) {
    const s = await one('SELECT id FROM suppliers WHERE id=? AND restaurant_id=?', [input.supplierId, restaurantId], db);
    if (!s) throw notFound('Supplier');
  }
  const goods = input.lines.reduce((s, l) => s.plus(D(l.quantity).times(D(l.unitCost))), D(0));
  const extra = D(input.extraCharges ?? 0);
  const total = goods.plus(extra);
  const res = await exec(
    'INSERT INTO purchases (restaurant_id, branch_id, supplier_id, reference, purchase_date, extra_charges, total, paid_via, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [restaurantId, input.branchId ?? null, input.supplierId ?? null, input.reference ?? null, input.purchaseDate, extra.toFixed(4), total.toFixed(4), input.paidVia, input.notes ?? null, userId], db);
  const purchaseId = res.insertId;
  for (const l of input.lines) {
    const qty = D(l.quantity);
    if (qty.lte(0)) throw badRequest('Purchase quantities must be positive');
    const lineValue = qty.times(D(l.unitCost));
    // landed cost: allocate extra charges by line value
    const landed = goods.gt(0) ? D(l.unitCost).plus(extra.times(lineValue).div(goods).div(qty)) : D(l.unitCost);
    await exec('INSERT INTO purchase_lines (restaurant_id, purchase_id, ingredient_id, quantity, unit_cost, landed_unit_cost) VALUES (?,?,?,?,?,?)',
      [restaurantId, purchaseId, l.ingredientId, qty.toFixed(4), D(l.unitCost).toFixed(6), landed.toFixed(6)], db);
    await moveStock(db, { restaurantId, ingredientId: l.ingredientId, qty, type: 'purchase', unitCost: landed, refType: 'purchase', refId: purchaseId, userId, branchId: input.branchId });
  }
  await postTxn(db, {
    restaurantId, branchId: input.branchId, refType: 'purchase', refId: purchaseId, memo: `Purchase ${input.reference || purchaseId}`,
    legs: [{ account: 'inventory', debit: total.toFixed(4) }, { account: input.paidVia === 'credit' ? 'accounts_payable' : input.paidVia, credit: total.toFixed(4) }],
  });
  return purchaseId;
}
