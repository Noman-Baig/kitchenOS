import fs from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT } from '../config.js';
import { exec, one, pool, toJson } from '../lib/db.js';
import { DEFAULT_AUTOMATIONS, DEFAULT_BRANDING, DEFAULT_SUBSCRIPTION } from '../services/settings.js';

/**
 * Production-safe seed: platform defaults, starter plans and agreement v1.0. Idempotent (never overwrites existing settings).
 * `--demo` additionally creates a fully configured demo restaurant (for evaluation/staging only).
 */
export async function seed(opts: { demo?: boolean } = {}, log = console.log) {
  for (const [k, v] of [['branding', DEFAULT_BRANDING], ['subscription', DEFAULT_SUBSCRIPTION], ['automations', DEFAULT_AUTOMATIONS]] as const) {
    await exec('INSERT IGNORE INTO platform_settings (setting_key, setting_value) VALUES (?,?)', [k, toJson(v)]);
  }
  const plans = await one<any>('SELECT COUNT(*) c FROM subscription_plans');
  if (!Number(plans.c)) {
    await exec(`INSERT INTO subscription_plans (name, description, price, currency, duration_days, max_branches, features, sort_order) VALUES
      ('Starter', 'Single location with QR ordering, POS and kitchen display', '29.0000', 'USD', 30, 1, ?, 1),
      ('Professional', 'Inventory, recipe costing, loyalty and full reports', '59.0000', 'USD', 30, 3, ?, 2),
      ('Enterprise', 'Multi-branch groups with consolidated reporting', '149.0000', 'USD', 30, 25, ?, 3)`,
    [toJson(['QR table ordering', 'Online ordering', 'POS counter', 'Kitchen display', 'Billing & taxes']),
      toJson(['Everything in Starter', 'Inventory & recipes', 'Food cost analytics', 'Loyalty & coupons', 'Reservations', 'Payroll & expenses']),
      toJson(['Everything in Professional', 'Up to 25 branches', 'Branch comparison', 'Priority support'])]);
    log('created starter plans (edit prices/currency in Super Admin → Plans)');
  }
  const ag = await one<any>('SELECT COUNT(*) c FROM agreements');
  if (!Number(ag.c)) {
    const body = await fs.readFile(path.join(PROJECT_ROOT, 'database', 'seeds', 'agreement-v1.txt'), 'utf8');
    await exec("INSERT INTO agreements (version, title, body, is_material, is_current) VALUES ('1.0', 'Platform Subscription and Services Agreement', ?, 1, 1)", [body]);
    log('created agreement v1.0');
  }
  if (opts.demo) {
    const { seedDemo } = await import('./demoData.js');
    await seedDemo(log);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed({ demo: process.argv.includes('--demo') }).then(async () => { await pool.end(); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
}
