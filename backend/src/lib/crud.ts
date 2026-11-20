import type { Router, Request } from 'express';
import { z, type ZodObject, type ZodRawShape } from 'zod';
import { exec, j, one, q, toJson, type Db, pool } from './db.js';
import { ah, idParam, pageParams, parse } from './http.js';
import { badRequest, notFound } from './errors.js';
import { requirePerm } from '../middleware/auth.js';
import type { Permission } from './permissions.js';
import { actorFromReq, audit } from './audit.js';

/**
 * Tenant-scoped CRUD generator for simple entities. Every statement includes `restaurant_id = <session tenant>`,
 * and every foreign key listed in `refs` is verified to belong to the same tenant before writing.
 */
export interface CrudOptions<S extends ZodRawShape> {
  path: string;
  table: string;
  entity: string;
  read: Permission;
  write: Permission;
  shape: S;
  searchable?: string[];
  filters?: string[];
  orderBy?: string;
  refs?: Record<string, string>;
  jsonCols?: string[];
  softDeleteCol?: string;
  select?: string;
  hooks?: {
    beforeWrite?: (req: Request, data: Record<string, unknown>, existing: any | null, db: Db) => Promise<void>;
    afterWrite?: (req: Request, id: number, db: Db) => Promise<void>;
    beforeDelete?: (req: Request, existing: any, db: Db) => Promise<void>;
  };
  noCreate?: boolean;
  noDelete?: boolean;
}

export async function assertRefs(db: Db, restaurantId: number, refs: Record<string, string> | undefined, data: Record<string, unknown>) {
  if (!refs) return;
  for (const [col, table] of Object.entries(refs)) {
    const v = data[col];
    if (v === undefined || v === null) continue;
    const ok = await one(`SELECT id FROM \`${table}\` WHERE id=? AND restaurant_id=?`, [v, restaurantId], db);
    if (!ok) throw badRequest(`Invalid ${col}`);
  }
}

function serialize(data: Record<string, unknown>, jsonCols: string[]) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    out[k] = jsonCols.includes(k) ? toJson(v) : typeof v === 'boolean' ? (v ? 1 : 0) : v;
  }
  return out;
}

export function crud<S extends ZodRawShape>(router: Router, o: CrudOptions<S>) {
  const createSchema: ZodObject<S> = z.object(o.shape);
  const updateSchema = createSchema.partial();
  const jsonCols = o.jsonCols ?? [];
  const decode = (row: any) => { if (!row) return row; for (const c of jsonCols) row[c] = j(row[c], null); return row; };
  const sel = o.select ?? '*';

  router.get(o.path, requirePerm(o.read), ah(async (req, res) => {
    const rid = req.user!.restaurantId!;
    const { page, pageSize, offset } = pageParams(req);
    const where = ['restaurant_id=?']; const params: unknown[] = [rid];
    if (o.softDeleteCol && req.query.includeInactive !== '1') { where.push(`${o.softDeleteCol}=1`); }
    for (const f of o.filters ?? []) {
      const v = req.query[f];
      if (v !== undefined && v !== '') { where.push(`\`${f}\`=?`); params.push(String(v)); }
    }
    const s = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    if (s && o.searchable?.length) { where.push('(' + o.searchable.map((c) => `\`${c}\` LIKE ?`).join(' OR ') + ')'); o.searchable.forEach(() => params.push(`%${s}%`)); }
    const whereSql = where.join(' AND ');
    const [rows, count] = await Promise.all([
      q<any>(`SELECT ${sel} FROM \`${o.table}\` WHERE ${whereSql} ORDER BY ${o.orderBy ?? 'id DESC'} LIMIT ? OFFSET ?`, [...params, pageSize, offset]),
      one<any>(`SELECT COUNT(*) c FROM \`${o.table}\` WHERE ${whereSql}`, params),
    ]);
    res.json({ data: rows.map(decode), page, pageSize, total: Number(count?.c ?? 0) });
  }));

  router.get(`${o.path}/:id`, requirePerm(o.read), ah(async (req, res) => {
    const row = await one<any>(`SELECT ${sel} FROM \`${o.table}\` WHERE id=? AND restaurant_id=?`, [idParam(req), req.user!.restaurantId]);
    if (!row) throw notFound(o.entity);
    res.json({ data: decode(row) });
  }));

  if (!o.noCreate) router.post(o.path, requirePerm(o.write), ah(async (req, res) => {
    const rid = req.user!.restaurantId!;
    const data = parse(createSchema, req.body) as Record<string, unknown>;
    await assertRefs(pool, rid, o.refs, data);
    await o.hooks?.beforeWrite?.(req, data, null, pool);
    const ser = serialize(data, jsonCols);
    const cols = Object.keys(ser);
    const r = await exec(`INSERT INTO \`${o.table}\` (restaurant_id${cols.map((c) => `,\`${c}\``).join('')}) VALUES (?${cols.map(() => ',?').join('')})`, [rid, ...cols.map((c) => ser[c])]);
    await o.hooks?.afterWrite?.(req, r.insertId, pool);
    await audit(actorFromReq(req), `${o.entity}.create`, o.table, r.insertId, data);
    const row = await one<any>(`SELECT ${sel} FROM \`${o.table}\` WHERE id=?`, [r.insertId]);
    res.status(201).json({ data: decode(row) });
  }));

  router.patch(`${o.path}/:id`, requirePerm(o.write), ah(async (req, res) => {
    const rid = req.user!.restaurantId!;
    const id = idParam(req);
    const existing = await one<any>(`SELECT * FROM \`${o.table}\` WHERE id=? AND restaurant_id=?`, [id, rid]);
    if (!existing) throw notFound(o.entity);
    const data = parse(updateSchema, req.body) as Record<string, unknown>;
    await assertRefs(pool, rid, o.refs, data);
    await o.hooks?.beforeWrite?.(req, data, existing, pool);
    const ser = serialize(data, jsonCols);
    const cols = Object.keys(ser);
    if (cols.length) await exec(`UPDATE \`${o.table}\` SET ${cols.map((c) => `\`${c}\`=?`).join(',')} WHERE id=? AND restaurant_id=?`, [...cols.map((c) => ser[c]), id, rid]);
    await o.hooks?.afterWrite?.(req, id, pool);
    await audit(actorFromReq(req), `${o.entity}.update`, o.table, id, { changes: data });
    const row = await one<any>(`SELECT ${sel} FROM \`${o.table}\` WHERE id=?`, [id]);
    res.json({ data: decode(row) });
  }));

  if (!o.noDelete) router.delete(`${o.path}/:id`, requirePerm(o.write), ah(async (req, res) => {
    const rid = req.user!.restaurantId!;
    const id = idParam(req);
    const existing = await one<any>(`SELECT * FROM \`${o.table}\` WHERE id=? AND restaurant_id=?`, [id, rid]);
    if (!existing) throw notFound(o.entity);
    await o.hooks?.beforeDelete?.(req, existing, pool);
    if (o.softDeleteCol) await exec(`UPDATE \`${o.table}\` SET \`${o.softDeleteCol}\`=0 WHERE id=? AND restaurant_id=?`, [id, rid]);
    else await exec(`DELETE FROM \`${o.table}\` WHERE id=? AND restaurant_id=?`, [id, rid]);
    await audit(actorFromReq(req), `${o.entity}.delete`, o.table, id, existing);
    res.json({ ok: true });
  }));
}

/* common zod helpers */
export const zMoney = z.union([z.string(), z.number()]).transform((v) => String(v)).refine((v) => /^-?\d{1,15}(\.\d{1,4})?$/.test(v), 'Invalid amount');
export const zPosMoney = zMoney.refine((v) => !v.startsWith('-'), 'Must not be negative');
export const zQty = z.union([z.string(), z.number()]).transform((v) => String(v)).refine((v) => /^-?\d{1,12}(\.\d{1,4})?$/.test(v), 'Invalid quantity');
export const zId = z.coerce.number().int().positive();
export const zBool = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform((v) => !!v);
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
