import { exec, one, toJson, tx } from '../lib/db.js';
import { randomToken, uuid } from '../lib/crypto.js';
import { DEFAULT_ROLES } from '../lib/permissions.js';
import { DEFAULT_RESTAURANT_SETTINGS } from '../services/settings.js';
import { hashPassword } from '../routes/auth.js';
import { moveStock } from '../services/inventory.js';
import { postTxn } from '../services/ledger.js';
import { D } from '../lib/money.js';

/** Demo restaurant for staging/evaluation. Credentials are printed once; change them immediately. */
export async function seedDemo(log = console.log) {
  if (await one("SELECT id FROM restaurants WHERE slug='demo-bistro'")) { log('demo restaurant already exists'); return; }
  const password = `Demo-${randomToken(6)}1`;
  await tx(async (db) => {
    const r = await exec(`INSERT INTO restaurants (public_id, slug, name, country, city, address, timezone, currency, contact_email, contact_phone, status, plan_id, settings, subscription_expires_at, approved_at, wifi_ssid, wifi_password)
      VALUES (?, 'demo-bistro', 'Demo Bistro', 'AE', 'Dubai', 'Sheikh Zayed Road, Dubai', 'Asia/Dubai', 'AED', 'demo@example.com', '+971 4 000 0000', 'active', (SELECT id FROM subscription_plans ORDER BY sort_order LIMIT 1 OFFSET 1), ?, DATE_ADD(NOW(), INTERVAL 30 DAY), NOW(), 'DemoBistro-Guest', 'welcome123')`,
      [uuid(), toJson({ ...DEFAULT_RESTAURANT_SETTINGS, loyalty: { ...DEFAULT_RESTAURANT_SETTINGS.loyalty, enabled: true } })], db);
    const rid = r.insertId;
    const branch = await exec("INSERT INTO branches (restaurant_id, name, address, is_main) VALUES (?, 'Main branch', 'Sheikh Zayed Road', 1)", [rid], db);
    const roleIds: Record<string, number> = {};
    for (const role of DEFAULT_ROLES) roleIds[role.key] = (await exec('INSERT INTO roles (restaurant_id, name, system_key, permissions) VALUES (?,?,?,?)', [rid, role.name, role.key, toJson(role.permissions)], db)).insertId;
    const pw = await hashPassword(password);
    for (const [email, name, role] of [['owner@demo-bistro.test', 'Olivia Owner', 'owner'], ['cashier@demo-bistro.test', 'Carl Cashier', 'cashier'], ['waiter@demo-bistro.test', 'Wendy Waiter', 'waiter'], ['kitchen@demo-bistro.test', 'Ken Kitchen', 'kitchen']]) {
      await exec('INSERT INTO users (restaurant_id, branch_id, role_id, email, password_hash, name, salary) VALUES (?,?,?,?,?,?,?)', [rid, branch.insertId, roleIds[role], email, pw, name, role === 'owner' ? null : '4000.0000'], db);
    }
    const st: Record<string, number> = {};
    for (const [i, n] of ['Main kitchen', 'Pizza', 'Drinks', 'Desserts'].entries()) st[n] = (await exec('INSERT INTO kitchen_stations (restaurant_id, name, sort_order) VALUES (?,?,?)', [rid, n, i], db)).insertId;
    await exec("INSERT INTO taxes (restaurant_id, name, calc_type, rate, inclusive, is_optional, default_selected, is_liability, sort_order) VALUES (?, 'VAT', 'percent', '5.0000', 0, 0, 1, 1, 1), (?, 'Service charge', 'percent', '10.0000', 0, 1, 1, 0, 2)", [rid, rid], db);
    await exec("INSERT INTO payment_methods (restaurant_id, type, label, bank_name, account_title, account_number, iban, instructions) VALUES (?, 'bank', 'Bank transfer', 'Demo Bank', 'Demo Bistro LLC', '0012345678', 'AE070331234567890123456', 'Use your table number as the reference.'), (?, 'cash', 'Cash', NULL, NULL, NULL, NULL, 'Pay cash to your waiter.')", [rid, rid], db);
    const cats: Record<string, number> = {};
    for (const [i, [n, s, p]] of ([['Pizza', 'Pizza', 15], ['Mains', 'Main kitchen', 20], ['Drinks', 'Drinks', 3], ['Desserts', 'Desserts', 8]] as const).entries()) cats[n] = (await exec('INSERT INTO menu_categories (restaurant_id, name, station_id, prep_minutes, sort_order) VALUES (?,?,?,?,?)', [rid, n, st[s], p, i], db)).insertId;
    const ing: Record<string, number> = {};
    for (const [n, u, min] of [['Cheese', 'g', 2000], ['Tomato sauce', 'g', 1500], ['Flour', 'g', 5000], ['Chicken', 'g', 3000], ['Rice', 'g', 4000], ['Lemon', 'pcs', 20], ['Coffee beans', 'g', 1000], ['Milk', 'ml', 3000]] as const) {
      ing[n] = (await exec('INSERT INTO ingredients (restaurant_id, name, unit, min_qty) VALUES (?,?,?,?)', [rid, n, u, min], db)).insertId;
    }
    const opening: [string, number, string][] = [['Cheese', 10000, '0.0300'], ['Tomato sauce', 8000, '0.0080'], ['Flour', 25000, '0.0020'], ['Chicken', 12000, '0.0250'], ['Rice', 20000, '0.0040'], ['Lemon', 100, '0.5000'], ['Coffee beans', 5000, '0.0600'], ['Milk', 10000, '0.0050']];
    let openingValue = D(0);
    for (const [n, qty, cost] of opening) { await moveStock(db, { restaurantId: rid, ingredientId: ing[n], qty, type: 'opening', unitCost: cost, refType: 'opening', note: 'Demo opening stock' }); openingValue = openingValue.plus(D(qty).times(cost)); }
    await postTxn(db, { restaurantId: rid, refType: 'opening_stock', memo: 'Opening stock', legs: [{ account: 'inventory', debit: openingValue.toFixed(4) }, { account: 'owner_equity', credit: openingValue.toFixed(4) }] });
    const items: [string, string, string, string, Record<string, number>][] = [
      ['Pizza', 'Margherita', 'Tomato, mozzarella, basil', '38.0000', { Cheese: 150, 'Tomato sauce': 80, Flour: 250 }],
      ['Pizza', 'Chicken BBQ Pizza', 'Smoky chicken, onions, BBQ sauce', '46.0000', { Cheese: 140, 'Tomato sauce': 60, Flour: 250, Chicken: 120 }],
      ['Mains', 'Lemon Chicken & Rice', 'Grilled chicken with herbed rice', '52.0000', { Chicken: 220, Rice: 180, Lemon: 1 }],
      ['Drinks', 'Fresh Lemonade', 'Freshly squeezed', '18.0000', { Lemon: 2 }],
      ['Drinks', 'Cappuccino', 'Double shot', '16.0000', { 'Coffee beans': 18, Milk: 150 }],
      ['Desserts', 'Cheesecake', 'Baked New York style', '28.0000', { Cheese: 90, Flour: 30 }],
    ];
    for (const [c, n, d, price, recipe] of items) {
      const item = await exec('INSERT INTO menu_items (restaurant_id, category_id, name, description, price, is_featured) VALUES (?,?,?,?,?,?)', [rid, cats[c], n, d, price, n === 'Margherita' ? 1 : 0], db);
      const rec = await exec('INSERT INTO recipes (restaurant_id, menu_item_id, yield_qty, wastage_pct) VALUES (?,?,1,2)', [rid, item.insertId], db);
      for (const [ingName, q] of Object.entries(recipe)) await exec('INSERT INTO recipe_lines (restaurant_id, recipe_id, ingredient_id, quantity) VALUES (?,?,?,?)', [rid, rec.insertId, ing[ingName], q], db);
      if (c === 'Pizza') {
        await exec("INSERT INTO item_variants (restaurant_id, item_id, name, price_delta, is_default, sort_order) VALUES (?,?, 'Regular', 0, 1, 0), (?,?, 'Large', '12.0000', 0, 1)", [rid, item.insertId, rid, item.insertId], db);
        await exec("INSERT INTO item_addons (restaurant_id, item_id, name, price, ingredient_id, ingredient_qty) VALUES (?,?, 'Extra cheese', '6.0000', ?, 60)", [rid, item.insertId, ing.Cheese], db);
      }
    }
    for (let i = 1; i <= 8; i++) {
      const t = await exec('INSERT INTO dining_tables (restaurant_id, branch_id, name, table_number, capacity) VALUES (?,?,?,?,?)', [rid, branch.insertId, `Table ${i}`, String(i), i <= 4 ? 2 : 4], db);
      await exec("INSERT INTO qr_tokens (restaurant_id, table_id, kind, token) VALUES (?,?,'table',?)", [rid, t.insertId, randomToken(24)], db);
    }
    await exec("INSERT INTO qr_tokens (restaurant_id, kind, token) VALUES (?,'online',?)", [rid, randomToken(24)], db);
  });
  log('demo restaurant "Demo Bistro" created (slug demo-bistro). Staff logins: owner@ / cashier@ / waiter@ / kitchen@demo-bistro.test');
  log(`demo password (shown once): ${password}`);
}
