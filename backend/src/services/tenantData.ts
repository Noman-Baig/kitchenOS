import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { exec, q, tx, pool } from '../lib/db.js';
import { sha256 } from '../lib/crypto.js';
import { deleteStoredFile } from './storage.js';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/** Every table that holds tenant data (restaurant_id column). Order matters for purge (children first). */
export const TENANT_TABLES = [
  'customer_session_tokens', 'chat_messages', 'call_records', 'support_requests', 'waiter_tasks', 'order_events', 'order_items', 'kitchen_tickets',
  'payments', 'refunds', 'bill_taxes', 'orders', 'bills', 'customer_sessions', 'loyalty_transactions', 'feedback', 'billing_discrepancies',
  'stock_movements', 'purchase_lines', 'purchases', 'wastage_records', 'recipe_lines', 'recipes', 'ingredients', 'suppliers',
  'item_addons', 'item_variants', 'menu_items', 'menu_categories', 'kitchen_stations', 'taxes', 'coupons', 'payment_methods',
  'reservations', 'waitlist', 'expenses', 'recurring_expenses', 'payroll_entries', 'ledger_entries', 'printers', 'pos_shifts',
  'qr_tokens', 'dining_tables', 'notifications', 'idempotency_keys', 'order_counters', 'subscription_payments', 'agreement_acceptances',
  'customers', 'roles', 'branches',
];

const SECRET_COLUMNS = new Set(['password_hash', 'token_hash', 'csrf_token', 'token', 'wifi_password']);

function scrub(rows: any[]) {
  return rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !SECRET_COLUMNS.has(k))));
}

/** Full JSON export of a restaurant (gzip), saved under backups/ with a checksum. */
export async function exportRestaurant(restaurantId: number) {
  const data: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    restaurant: scrub(await q('SELECT * FROM restaurants WHERE id=?', [restaurantId])),
    users: scrub(await q('SELECT * FROM users WHERE restaurant_id=?', [restaurantId])),
  };
  for (const t of TENANT_TABLES) data[t] = scrub(await q(`SELECT * FROM \`${t}\` WHERE restaurant_id=?`, [restaurantId]));
  data.files = await q('SELECT public_id, category, storage_key, mime, size_bytes, created_at FROM files WHERE restaurant_id=?', [restaurantId]);
  const json = Buffer.from(JSON.stringify(data));
  const gz = await gzip(json);
  const dir = path.join(config.backup.dir, 'restaurants');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `restaurant-${restaurantId}-${Date.now()}.json.gz`);
  await fs.writeFile(file, gz, { mode: 0o600 });
  // verify: decompress & parse
  JSON.parse((await gunzip(await fs.readFile(file))).toString());
  const sum = sha256(gz);
  const r = await exec("INSERT INTO backups (kind, restaurant_id, file_path, size_bytes, sha256, status, verified_at) VALUES ('restaurant_export',?,?,?,?,'verified',NOW(3))", [restaurantId, file, gz.length, sum]);
  return { backupId: r.insertId, file, size: gz.length, sha256: sum };
}

/** Irreversible purge — only called by the deletion job after export + approval rules are satisfied. */
export async function purgeRestaurant(restaurantId: number) {
  const files = await q<any>('SELECT storage_key, thumb_key FROM files WHERE restaurant_id=?', [restaurantId]);
  await tx(async (db) => {
    for (const t of TENANT_TABLES) await exec(`DELETE FROM \`${t}\` WHERE restaurant_id=?`, [restaurantId], db);
    await exec('DELETE s FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE u.restaurant_id=?', [restaurantId], db);
    await exec('DELETE FROM users WHERE restaurant_id=?', [restaurantId], db);
    await exec('DELETE FROM files WHERE restaurant_id=?', [restaurantId], db);
    await exec("UPDATE restaurants SET status='deleted', settings='{}', theme_draft=NULL, theme_published=NULL, wifi_password=NULL, contact_email=NULL, contact_phone=NULL, address=NULL, custom_domain=NULL, slug=CONCAT('deleted-', id) WHERE id=?", [restaurantId], db);
  });
  for (const f of files) await deleteStoredFile(f);
  void pool;
}
