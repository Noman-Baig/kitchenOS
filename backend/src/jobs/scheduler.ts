import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { exec, one, pool, q, toJson, tx } from '../lib/db.js';
import { logger } from '../lib/logger.js';
import { audit } from '../lib/audit.js';
import { getAutomations, getSubscriptionConfig } from '../services/settings.js';
import { computeAvailability, revokeRestaurantAccess } from '../services/restaurantStatus.js';
import { notify, restaurantAdminEmails } from '../services/notify.js';
import { exportRestaurant, purgeRestaurant } from '../services/tenantData.js';
import { deleteStoredFile } from '../services/storage.js';
import { pruneBackups, runBackupNow } from './backup.js';
import { createExpense, generatePayroll } from '../routes/restaurant/backoffice.js';

const SYSTEM = { type: 'system' as const };

/**
 * Duplicate-safe job runner:
 *  - MySQL GET_LOCK ensures only one worker (across all servers) runs a job at a time;
 *  - a unique `run_key` row in job_runs makes period-based jobs (daily/monthly) run exactly once, and retry if they failed.
 */
export async function runJob(job: string, runKey: string | null, fn: () => Promise<unknown>) {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query('SELECT GET_LOCK(?, 0) l', [`umema_job_${job}`]);
    if (!(rows as any)[0].l) return 'locked';
    const key = runKey ?? `${job}:${new Date().toISOString().slice(0, 16)}`;
    const prev = await one<any>('SELECT id, status FROM job_runs WHERE run_key=?', [key]);
    if (prev?.status === 'success' || prev?.status === 'running') return 'skipped';
    if (prev) await exec("UPDATE job_runs SET status='running', started_at=NOW(3), info=NULL WHERE id=?", [prev.id]);
    else await exec("INSERT INTO job_runs (job, run_key, status) VALUES (?,?,'running')", [job, key]);
    try {
      const info = await fn();
      await exec("UPDATE job_runs SET status='success', finished_at=NOW(3), info=? WHERE run_key=?", [toJson(info ?? null), key]);
      return 'success';
    } catch (err: any) {
      logger.error({ err, job }, 'job failed');
      await exec("UPDATE job_runs SET status='failed', finished_at=NOW(3), info=? WHERE run_key=?", [toJson({ error: String(err?.message || err) }), key]);
      return 'failed';
    }
  } finally {
    await conn.query('SELECT RELEASE_LOCK(?)', [`umema_job_${job}`]).catch(() => undefined);
    conn.release();
  }
}

const today = () => new Date().toISOString().slice(0, 10);

export async function subscriptionSweep() {
  const sub = await getSubscriptionConfig();
  const rs = await q<any>("SELECT * FROM restaurants WHERE status='active' AND subscription_expires_at IS NOT NULL AND subscription_expires_at < NOW()");
  let expired = 0;
  for (const r of rs) {
    const a = await computeAvailability(r);
    if (a.state !== 'expired') continue;
    const deletion = new Date(Date.now() + sub.dataRetentionDays * 86400000);
    await exec("UPDATE restaurants SET status='expired', status_reason='Subscription expired', deletion_scheduled_at=COALESCE(deletion_scheduled_at, ?) WHERE id=? AND status='active'", [deletion, r.id]);
    await revokeRestaurantAccess(r.id);
    await audit(SYSTEM, 'restaurant.expired', 'restaurant', r.id, { deletionScheduledAt: deletion }, undefined, r.id);
    await notify({ restaurantId: r.id, type: 'subscription_expired', title: 'Your subscription has expired', body: `Ordering and dashboard access are paused. Your restaurant data is scheduled for deletion in ${Math.round(sub.dataRetentionDays / 30)} months if your account is not reactivated. Submit a renewal payment to restore access.`, emailTo: await restaurantAdminEmails(r.id) });
    expired++;
  }
  return { expired };
}

export async function expiryReminders() {
  const sub = await getSubscriptionConfig();
  let sent = 0;
  for (const days of sub.reminderDaysBefore) {
    const rs = await q<any>("SELECT id, name, subscription_expires_at FROM restaurants WHERE status='active' AND DATE(subscription_expires_at)=DATE(DATE_ADD(UTC_DATE(), INTERVAL ? DAY))", [days]);
    for (const r of rs) {
      const ins = await exec('INSERT IGNORE INTO job_runs (job, run_key, status, finished_at) VALUES (?,?,"success",NOW(3))', ['expiryReminder', `expiryReminder:${r.id}:${days}:${today()}`]);
      if (!ins.affectedRows) continue;
      await notify({ restaurantId: r.id, type: 'subscription_reminder', permission: 'subscription.manage', title: `Subscription expires in ${days} day(s)`, body: `Your subscription expires on ${new Date(r.subscription_expires_at).toISOString().slice(0, 10)}. Renew to avoid interruption.`, emailTo: await restaurantAdminEmails(r.id) });
      sent++;
    }
  }
  // deletion countdown reminders: 30, 7 and 1 day before deletion
  for (const days of [30, 7, 1]) {
    const rs = await q<any>("SELECT id FROM restaurants WHERE status IN ('suspended','expired') AND DATE(deletion_scheduled_at)=DATE(DATE_ADD(UTC_DATE(), INTERVAL ? DAY))", [days]);
    for (const r of rs) {
      const ins = await exec('INSERT IGNORE INTO job_runs (job, run_key, status, finished_at) VALUES (?,?,"success",NOW(3))', ['deletionReminder', `deletionReminder:${r.id}:${days}`]);
      if (!ins.affectedRows) continue;
      await notify({ restaurantId: r.id, type: 'deletion_reminder', title: `Data deletion in ${days} day(s)`, body: 'Your restaurant data is scheduled for permanent deletion. Reactivate your account or request a data export before then.', emailTo: await restaurantAdminEmails(r.id) });
      await notify({ restaurantId: null, audience: 'platform', type: 'deletion_reminder', title: `Restaurant #${r.id} scheduled for deletion in ${days} day(s)`, data: { restaurantId: r.id } });
    }
  }
  return { sent };
}

/** Permanent deletion only when: scheduled date passed, restaurant inactive, AND (super-admin approved OR platform auto-delete enabled). Always exports first. */
export async function scheduledDeletion() {
  const sub = await getSubscriptionConfig();
  const rs = await q<any>("SELECT * FROM restaurants WHERE status IN ('suspended','expired','rejected') AND deletion_scheduled_at IS NOT NULL AND deletion_scheduled_at < NOW()");
  const done: number[] = [];
  for (const r of rs) {
    if (!r.deletion_approved && !sub.autoDeleteAfterRetention) continue;
    const exp = await exportRestaurant(r.id);
    await purgeRestaurant(r.id);
    await audit(SYSTEM, 'restaurant.purged', 'restaurant', r.id, { exportBackupId: exp.backupId, sha256: exp.sha256 }, undefined, r.id);
    await notify({ restaurantId: null, audience: 'platform', type: 'restaurant_purged', title: `Restaurant "${r.name}" data deleted`, body: `Final export kept as backup #${exp.backupId}.` });
    done.push(r.id);
  }
  return { purged: done };
}

export async function recurringExpenses() {
  const due = await q<any>('SELECT * FROM recurring_expenses WHERE active=1 AND next_run_date<=UTC_DATE() LIMIT 500');
  let created = 0;
  for (const r of due) {
    await tx(async (db) => {
      const cur = await one<any>('SELECT * FROM recurring_expenses WHERE id=? FOR UPDATE', [r.id], db);
      if (!cur || !cur.active) return;
      const date = new Date(cur.next_run_date).toISOString().slice(0, 10);
      const exists = await one('SELECT id FROM expenses WHERE recurring_id=? AND expense_date=?', [cur.id, date], db);
      if (!exists) { await createExpense(db, cur.restaurant_id, null, { category: cur.category, amount: cur.amount, expenseDate: date, description: `${cur.description || cur.category} (recurring)`, paidVia: cur.paid_via, branchId: cur.branch_id, recurringId: cur.id }); created++; }
      await exec(`UPDATE recurring_expenses SET next_run_date=DATE_ADD(next_run_date, INTERVAL 1 ${cur.frequency === 'weekly' ? 'WEEK' : 'MONTH'}) WHERE id=?`, [cur.id], db);
    });
  }
  return { created };
}

export async function payrollGeneration() {
  const d = new Date();
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const rs = await q<any>("SELECT id FROM restaurants WHERE status='active'");
  let created = 0;
  for (const r of rs) created += await generatePayroll(pool, r.id, start, end);
  return { created, period: start };
}

export async function reservationReminders() {
  const rs = await q<any>("SELECT * FROM reservations WHERE status IN ('confirmed','requested') AND reminded=0 AND reserved_for BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 60 MINUTE) LIMIT 500");
  for (const r of rs) {
    const upd = await exec('UPDATE reservations SET reminded=1 WHERE id=? AND reminded=0', [r.id]);
    if (!upd.affectedRows) continue;
    await notify({ restaurantId: r.restaurant_id, type: 'reservation_upcoming', permission: 'reservations.manage', title: `Upcoming reservation: ${r.customer_name} (${r.party_size})`, body: `${r.status === 'requested' ? 'Still awaiting confirmation. ' : ''}Arriving at ${new Date(r.reserved_for).toISOString().slice(11, 16)} UTC`, data: { reservationId: r.id } });
  }
  return { reminded: rs.length };
}

/** Expire idle customer sessions that have no open bill balance. Sessions with an unpaid open bill are kept. */
export async function customerSessionExpiry() {
  const r1 = await exec(`UPDATE customer_sessions cs LEFT JOIN bills b ON b.id=cs.bill_id SET cs.status='expired', cs.closed_at=NOW(3)
     WHERE cs.status='active' AND (cs.expires_at<NOW(3) OR cs.last_seen_at<DATE_SUB(NOW(3), INTERVAL 6 HOUR)) AND (b.id IS NULL OR b.status<>'open')`);
  await exec('UPDATE customer_session_tokens t JOIN customer_sessions cs ON cs.id=t.session_id SET t.revoked_at=NOW(3) WHERE cs.status=\'expired\' AND t.revoked_at IS NULL AND cs.closed_at<DATE_SUB(NOW(3), INTERVAL 1 DAY)');
  await exec('DELETE FROM idempotency_keys WHERE created_at<DATE_SUB(NOW(3), INTERVAL 7 DAY)');
  await exec('DELETE FROM auth_sessions WHERE (expires_at<DATE_SUB(NOW(3), INTERVAL 30 DAY)) OR (revoked_at IS NOT NULL AND revoked_at<DATE_SUB(NOW(3), INTERVAL 30 DAY))');
  return { expired: r1.affectedRows };
}

export async function tempCleanup() {
  const expired = await q<any>("SELECT id, storage_key, thumb_key FROM files WHERE (expires_at IS NOT NULL AND expires_at<NOW()) OR (category='temporary' AND created_at<DATE_SUB(NOW(), INTERVAL 1 DAY)) LIMIT 1000");
  for (const f of expired) { await deleteStoredFile(f); await exec('DELETE FROM files WHERE id=?', [f.id]); }
  // orphaned temp files on disk
  const tmp = path.join(config.storage.dir, 'temporary');
  let removed = 0;
  try {
    for (const name of await fs.readdir(tmp, { recursive: true }) as string[]) {
      const p = path.join(tmp, name);
      const st = await fs.stat(p).catch(() => null);
      if (st?.isFile() && Date.now() - st.mtimeMs > 86400000) { await fs.unlink(p).catch(() => undefined); removed++; }
    }
  } catch { /* dir may not exist */ }
  return { files: expired.length, orphans: removed };
}

type Task = { name: keyof Awaited<ReturnType<typeof getAutomations>>; everyMs: number; key: () => string | null; fn: () => Promise<unknown> };
const hourKey = () => new Date().toISOString().slice(0, 13);
const TASKS: Task[] = [
  { name: 'subscriptionSweep', everyMs: 5 * 60_000, key: () => null, fn: subscriptionSweep },
  { name: 'expiryReminders', everyMs: 60 * 60_000, key: () => `expiryReminders:${hourKey()}`, fn: expiryReminders },
  { name: 'scheduledDeletion', everyMs: 60 * 60_000, key: () => `scheduledDeletion:${hourKey()}`, fn: scheduledDeletion },
  { name: 'recurringExpenses', everyMs: 30 * 60_000, key: () => null, fn: recurringExpenses },
  { name: 'payrollGeneration', everyMs: 6 * 60 * 60_000, key: () => `payroll:${new Date().toISOString().slice(0, 7)}`, fn: payrollGeneration },
  { name: 'reservationReminders', everyMs: 5 * 60_000, key: () => null, fn: reservationReminders },
  { name: 'customerSessionExpiry', everyMs: 15 * 60_000, key: () => null, fn: customerSessionExpiry },
  { name: 'tempCleanup', everyMs: 60 * 60_000, key: () => `tempCleanup:${hourKey()}`, fn: tempCleanup },
  { name: 'databaseBackup', everyMs: 15 * 60_000, key: () => (new Date().getUTCHours() === config.backup.hourUtc ? `dbBackup:${today()}` : 'never'), fn: async () => { const r = await runBackupNow('database'); if (r.status === 'failed') throw new Error(r.error); await pruneBackups(); return r; } },
  { name: 'storageBackup', everyMs: 15 * 60_000, key: () => (new Date().getUTCHours() === config.backup.hourUtc ? `storageBackup:${today()}` : 'never'), fn: async () => { const r = await runBackupNow('storage'); if (r.status === 'failed') throw new Error(r.error); return r; } },
];

export function startScheduler() {
  const timers: NodeJS.Timeout[] = [];
  const last = new Map<string, number>();
  const tick = async () => {
    let enabled: Record<string, boolean>;
    try { enabled = await getAutomations() as any; } catch { return; }
    for (const t of TASKS) {
      if (enabled[t.name] === false) continue;
      if (Date.now() - (last.get(t.name) ?? 0) < t.everyMs) continue;
      last.set(t.name, Date.now());
      const key = t.key();
      if (key === 'never') continue;
      const job = t.name === 'databaseBackup' || t.name === 'storageBackup' ? t.name : t.name;
      runJob(job, key, t.fn).catch((err) => logger.error({ err, job }, 'job crashed'));
    }
  };
  timers.push(setInterval(() => void tick(), 60_000));
  setTimeout(() => void tick(), 5_000);
  // keep job history bounded
  timers.push(setInterval(() => void exec('DELETE FROM job_runs WHERE started_at<DATE_SUB(NOW(), INTERVAL 60 DAY)').catch(() => undefined), 24 * 3600_000));
  return () => timers.forEach((t) => clearInterval(t));
}
