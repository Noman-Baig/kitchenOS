import { Router } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { config } from '../../config.js';
import { exec, one, q, tx } from '../../lib/db.js';
import { ah, idParam, parse } from '../../lib/http.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { actorFromReq, audit } from '../../lib/audit.js';
import { crud, zBool, zMoney, zPosMoney, zQty } from '../../lib/crud.js';
import { requirePerm } from '../../middleware/auth.js';
import { randomToken } from '../../lib/crypto.js';
import { invalidateMenu, publicMenu } from '../../services/menu.js';
import { recipeCost } from '../../services/inventory.js';
import { pool } from '../../lib/db.js';

export const menuRouter = Router();
const inval = { afterWrite: async (req: any) => invalidateMenu(req.restaurant.id) };

crud(menuRouter, {
  path: '/stations', table: 'kitchen_stations', entity: 'station', read: 'kitchen.view', write: 'menu.manage', orderBy: 'sort_order, name', refs: { branch_id: 'branches' },
  shape: { name: z.string().min(1).max(80), sort_order: z.number().int().optional(), active: zBool.optional(), branch_id: z.number().int().positive().nullable().optional() },
});
crud(menuRouter, {
  path: '/categories', table: 'menu_categories', entity: 'category', read: 'orders.view', write: 'menu.manage', orderBy: 'sort_order, name', refs: { station_id: 'kitchen_stations' },
  shape: { name: z.string().min(1).max(120), description: z.string().max(500).nullable().optional(), station_id: z.number().int().positive().nullable().optional(), prep_minutes: z.number().int().min(0).max(600).nullable().optional(), sort_order: z.number().int().optional(), active: zBool.optional() },
  hooks: { ...inval, beforeDelete: async (_req, existing) => { const c = await one<any>('SELECT COUNT(*) c FROM menu_items WHERE category_id=? AND active=1', [existing.id]); if (Number(c.c)) throw badRequest('Move or remove the items in this category first'); } },
});
crud(menuRouter, {
  path: '/items', table: 'menu_items', entity: 'menu_item', read: 'orders.view', write: 'menu.manage', orderBy: 'category_id, sort_order, name', searchable: ['name'], filters: ['category_id', 'available'],
  refs: { category_id: 'menu_categories', station_id: 'kitchen_stations', image_file_id: 'files' }, softDeleteCol: 'active',
  shape: {
    category_id: z.number().int().positive(), name: z.string().min(1).max(190), description: z.string().max(1000).nullable().optional(), image_file_id: z.number().int().positive().nullable().optional(),
    price: zPosMoney, prep_minutes: z.number().int().min(0).max(600).nullable().optional(), station_id: z.number().int().positive().nullable().optional(),
    allergens: z.string().max(500).nullable().optional(), ingredients_text: z.string().max(1000).nullable().optional(), is_featured: zBool.optional(), available: zBool.optional(),
    online_enabled: zBool.optional(), sort_order: z.number().int().optional(), active: zBool.optional(),
  },
  hooks: inval,
});

/** Fast availability toggle — pushes live to customer menus. */
menuRouter.post('/items/:id/availability', requirePerm('menu.manage', 'kitchen.update'), ah(async (req, res) => {
  const b = parse(z.object({ available: z.boolean() }), req.body);
  const r = await exec('UPDATE menu_items SET available=? WHERE id=? AND restaurant_id=?', [b.available ? 1 : 0, idParam(req), req.restaurant.id]);
  if (!r.affectedRows) throw notFound('Menu item');
  invalidateMenu(req.restaurant.id);
  await audit(actorFromReq(req), 'menu_item.availability', 'menu_items', idParam(req), b);
  res.json({ ok: true });
}));

menuRouter.get('/items/:id/full', requirePerm('orders.view'), ah(async (req, res) => {
  const id = idParam(req);
  const item = await one<any>('SELECT mi.*, f.public_id image_public_id FROM menu_items mi LEFT JOIN files f ON f.id=mi.image_file_id WHERE mi.id=? AND mi.restaurant_id=?', [id, req.restaurant.id]);
  if (!item) throw notFound('Menu item');
  const [variants, addons] = await Promise.all([
    q('SELECT * FROM item_variants WHERE item_id=? AND restaurant_id=? AND active=1 ORDER BY sort_order, id', [id, req.restaurant.id]),
    q('SELECT * FROM item_addons WHERE item_id=? AND restaurant_id=? AND active=1 ORDER BY id', [id, req.restaurant.id]),
  ]);
  const cost = await recipeCost(pool, req.restaurant.id, id, null);
  res.json({ data: { ...item, imageUrl: item.image_public_id ? `/api/v1/files/${item.image_public_id}` : null, variants, addons, recipeCost: cost?.toFixed(4) ?? null } });
}));

const variantShape = { name: z.string().min(1).max(120), price_delta: zMoney, is_default: zBool.optional(), sort_order: z.number().int().optional() };
const addonShape = { name: z.string().min(1).max(120), price: zPosMoney, ingredient_id: z.number().int().positive().nullable().optional(), ingredient_qty: zQty.nullable().optional() };

async function itemOr404(req: any) {
  const it = await one<any>('SELECT id FROM menu_items WHERE id=? AND restaurant_id=?', [idParam(req, 'itemId'), req.restaurant.id]);
  if (!it) throw notFound('Menu item');
  return it.id as number;
}
menuRouter.post('/items/:itemId/variants', requirePerm('menu.manage'), ah(async (req, res) => {
  const itemId = await itemOr404(req); const b = parse(z.object(variantShape), req.body);
  if (b.is_default) await exec('UPDATE item_variants SET is_default=0 WHERE item_id=?', [itemId]);
  const r = await exec('INSERT INTO item_variants (restaurant_id, item_id, name, price_delta, is_default, sort_order) VALUES (?,?,?,?,?,?)', [req.restaurant.id, itemId, b.name, b.price_delta, b.is_default ? 1 : 0, b.sort_order ?? 0]);
  invalidateMenu(req.restaurant.id); res.status(201).json({ data: { id: r.insertId } });
}));
menuRouter.patch('/items/:itemId/variants/:id', requirePerm('menu.manage'), ah(async (req, res) => {
  const itemId = await itemOr404(req); const b = parse(z.object(variantShape).partial(), req.body);
  if (b.is_default) await exec('UPDATE item_variants SET is_default=0 WHERE item_id=?', [itemId]);
  const sets = Object.entries(b).map(([k]) => `\`${k}\`=?`); const vals = Object.values(b).map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : v));
  if (sets.length) await exec(`UPDATE item_variants SET ${sets.join(',')} WHERE id=? AND item_id=? AND restaurant_id=?`, [...vals, idParam(req), itemId, req.restaurant.id]);
  invalidateMenu(req.restaurant.id); res.json({ ok: true });
}));
menuRouter.delete('/items/:itemId/variants/:id', requirePerm('menu.manage'), ah(async (req, res) => {
  const itemId = await itemOr404(req);
  await exec('UPDATE item_variants SET active=0 WHERE id=? AND item_id=? AND restaurant_id=?', [idParam(req), itemId, req.restaurant.id]);
  invalidateMenu(req.restaurant.id); res.json({ ok: true });
}));
menuRouter.post('/items/:itemId/addons', requirePerm('menu.manage'), ah(async (req, res) => {
  const itemId = await itemOr404(req); const b = parse(z.object(addonShape), req.body);
  if (b.ingredient_id && !(await one('SELECT id FROM ingredients WHERE id=? AND restaurant_id=?', [b.ingredient_id, req.restaurant.id]))) throw badRequest('Invalid ingredient');
  const r = await exec('INSERT INTO item_addons (restaurant_id, item_id, name, price, ingredient_id, ingredient_qty) VALUES (?,?,?,?,?,?)', [req.restaurant.id, itemId, b.name, b.price, b.ingredient_id ?? null, b.ingredient_qty ?? null]);
  invalidateMenu(req.restaurant.id); res.status(201).json({ data: { id: r.insertId } });
}));
menuRouter.delete('/items/:itemId/addons/:id', requirePerm('menu.manage'), ah(async (req, res) => {
  const itemId = await itemOr404(req);
  await exec('UPDATE item_addons SET active=0 WHERE id=? AND item_id=? AND restaurant_id=?', [idParam(req), itemId, req.restaurant.id]);
  invalidateMenu(req.restaurant.id); res.json({ ok: true });
}));

menuRouter.get('/menu', requirePerm('orders.view', 'pos.use', 'waiter.use'), ah(async (req, res) => {
  res.json({ data: await publicMenu(req.restaurant.id, 'staff') });
}));

/* ------------------------------- Tables & QR ------------------------------- */
crud(menuRouter, {
  path: '/tables', table: 'dining_tables', entity: 'table', read: 'orders.view', write: 'tables.manage', orderBy: 'branch_id, CAST(table_number AS UNSIGNED), table_number',
  refs: { branch_id: 'branches', waiter_user_id: 'users' }, filters: ['branch_id', 'active'],
  shape: { name: z.string().min(1).max(80), table_number: z.string().min(1).max(20), capacity: z.number().int().min(1).max(100), area: z.string().max(80).nullable().optional(), branch_id: z.number().int().positive().nullable().optional(), waiter_user_id: z.number().int().positive().nullable().optional(), active: zBool.optional() },
  hooks: {
    afterWrite: async (req, id) => {
      const has = await one("SELECT id FROM qr_tokens WHERE table_id=? AND kind='table' AND active=1", [id]);
      if (!has) await exec("INSERT INTO qr_tokens (restaurant_id, table_id, kind, token, created_by) VALUES (?,?,'table',?,?)", [req.restaurant.id, id, randomToken(24), req.user!.id]);
    },
    beforeDelete: async (_req, existing) => {
      const open = await one<any>("SELECT COUNT(*) c FROM bills WHERE table_id=? AND status='open'", [existing.id]);
      if (Number(open.c)) throw badRequest('Table has an open bill');
      await exec('UPDATE qr_tokens SET active=0, revoked_at=NOW(3) WHERE table_id=? AND active=1', [existing.id]);
    },
  },
  softDeleteCol: 'active',
});

menuRouter.get('/tables-overview', requirePerm('orders.view', 'waiter.use'), ah(async (req, res) => {
  const rows = await q<any>(`SELECT t.id, t.name, t.table_number, t.capacity, t.area, t.branch_id, t.waiter_user_id, t.active,
      (SELECT cs.id FROM customer_sessions cs WHERE cs.table_id=t.id AND cs.status='active' AND cs.expires_at>NOW(3) ORDER BY cs.id DESC LIMIT 1) session_id,
      (SELECT cs.join_pin FROM customer_sessions cs WHERE cs.table_id=t.id AND cs.status='active' AND cs.expires_at>NOW(3) ORDER BY cs.id DESC LIMIT 1) session_pin,
      (SELECT cs.customer_name FROM customer_sessions cs WHERE cs.table_id=t.id AND cs.status='active' AND cs.expires_at>NOW(3) ORDER BY cs.id DESC LIMIT 1) customer_name,
      (SELECT b.id FROM bills b WHERE b.table_id=t.id AND b.status='open' ORDER BY b.id DESC LIMIT 1) open_bill_id,
      (SELECT b.total FROM bills b WHERE b.table_id=t.id AND b.status='open' ORDER BY b.id DESC LIMIT 1) open_bill_total,
      (SELECT COUNT(*) FROM support_requests s WHERE s.table_id=t.id AND s.status<>'resolved') open_requests
    FROM dining_tables t WHERE t.restaurant_id=? AND t.active=1 ORDER BY t.branch_id, CAST(t.table_number AS UNSIGNED), t.table_number`, [req.restaurant.id]);
  res.json({ data: rows });
}));

menuRouter.get('/tables/:id/qr', requirePerm('tables.manage'), ah(async (req, res) => {
  const t = await one<any>("SELECT q.token, d.name, d.table_number FROM qr_tokens q JOIN dining_tables d ON d.id=q.table_id WHERE q.table_id=? AND q.restaurant_id=? AND q.kind='table' AND q.active=1 ORDER BY q.id DESC LIMIT 1", [idParam(req), req.restaurant.id]);
  if (!t) throw notFound('QR code');
  const url = `${config.appUrl}/t/${t.token}`;
  if (req.query.format === 'json') return res.json({ data: { url, name: t.name, number: t.table_number } });
  if (req.query.format === 'png') { res.type('image/png'); return res.send(await QRCode.toBuffer(url, { width: 1024, margin: 2, errorCorrectionLevel: 'M' })); }
  res.type('image/svg+xml').send(await QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }));
}));

/** Regenerate: revokes the previous token immediately — old printed QR codes stop working. */
menuRouter.post('/tables/:id/qr/regenerate', requirePerm('tables.manage'), ah(async (req, res) => {
  const id = idParam(req);
  const t = await one('SELECT id FROM dining_tables WHERE id=? AND restaurant_id=?', [id, req.restaurant.id]);
  if (!t) throw notFound('Table');
  await tx(async (db) => {
    await exec("UPDATE qr_tokens SET active=0, revoked_at=NOW(3) WHERE table_id=? AND kind='table' AND active=1", [id], db);
    await exec("INSERT INTO qr_tokens (restaurant_id, table_id, kind, token, created_by) VALUES (?,?,'table',?,?)", [req.restaurant.id, id, randomToken(24), req.user!.id], db);
  });
  await audit(actorFromReq(req), 'qr.regenerate', 'dining_tables', id);
  res.json({ ok: true });
}));
menuRouter.post('/tables/:id/qr/block', requirePerm('tables.manage'), ah(async (req, res) => {
  const id = idParam(req);
  await exec("UPDATE qr_tokens SET active=0, revoked_at=NOW(3) WHERE table_id=? AND restaurant_id=? AND kind='table' AND active=1", [id, req.restaurant.id]);
  await audit(actorFromReq(req), 'qr.block', 'dining_tables', id);
  res.json({ ok: true });
}));
menuRouter.post('/qr/online/regenerate', requirePerm('tables.manage'), ah(async (req, res) => {
  await tx(async (db) => {
    await exec("UPDATE qr_tokens SET active=0, revoked_at=NOW(3) WHERE restaurant_id=? AND kind='online' AND active=1", [req.restaurant.id], db);
    await exec("INSERT INTO qr_tokens (restaurant_id, kind, token, created_by) VALUES (?,'online',?,?)", [req.restaurant.id, randomToken(24), req.user!.id], db);
  });
  await audit(actorFromReq(req), 'qr.online_regenerate', 'restaurant', req.restaurant.id);
  res.json({ ok: true });
}));

/** End a table session (e.g. guests left) — staff only. */
menuRouter.post('/tables/:id/close-session', requirePerm('orders.manage'), ah(async (req, res) => {
  const id = idParam(req);
  const open = await one<any>("SELECT id FROM bills WHERE table_id=? AND restaurant_id=? AND status='open'", [id, req.restaurant.id]);
  if (open) throw badRequest('Close or settle the open bill first');
  await exec("UPDATE customer_sessions SET status='closed', closed_at=NOW(3) WHERE table_id=? AND restaurant_id=? AND status='active'", [id, req.restaurant.id]);
  await audit(actorFromReq(req), 'table.session_closed', 'dining_tables', id);
  res.json({ ok: true });
}));
