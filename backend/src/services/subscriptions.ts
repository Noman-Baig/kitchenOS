import { exec, one, type Db } from '../lib/db.js';
import { conflict, notFound } from '../lib/errors.js';
import { audit, type Actor } from '../lib/audit.js';
import { notify, restaurantAdminEmails } from './notify.js';
import { revokeRestaurantAccess } from './restaurantStatus.js';
import { getSubscriptionConfig } from './settings.js';

export async function approveSubscriptionPayment(db: Db, paymentId: number, actor: Actor) {
  const p = await one<any>('SELECT * FROM subscription_payments WHERE id=? FOR UPDATE', [paymentId], db);
  if (!p) throw notFound('Subscription payment');
  if (p.status !== 'pending') throw conflict(`Payment already ${p.status}`);
  const r = await one<any>('SELECT * FROM restaurants WHERE id=? FOR UPDATE', [p.restaurant_id], db);
  const plan = await one<any>('SELECT * FROM subscription_plans WHERE id=?', [p.plan_id], db);
  const now = new Date();
  const currentEnd = r.subscription_expires_at ? new Date(r.subscription_expires_at) : null;
  const start = currentEnd && currentEnd > now ? currentEnd : now;
  const end = new Date(start.getTime() + (plan?.duration_days ?? 30) * 86400000);
  await exec("UPDATE subscription_payments SET status='approved', reviewed_by=?, reviewed_at=NOW(3), period_start=?, period_end=? WHERE id=?", [actor.userId, start, end, p.id], db);
  const reactivate = r.status === 'expired' || (r.status === 'active');
  await exec(`UPDATE restaurants SET subscription_expires_at=?, plan_id=?, deletion_scheduled_at=IF(?, NULL, deletion_scheduled_at), deletion_approved=IF(?,0,deletion_approved), status=IF(status='expired','active',status), status_reason=IF(status='expired',NULL,status_reason) WHERE id=?`,
    [end, p.plan_id, reactivate ? 1 : 0, reactivate ? 1 : 0, r.id], db);
  await audit(actor, 'subscription.payment_approved', 'subscription_payment', p.id, { restaurantId: r.id, periodEnd: end }, db, r.id);
  await notify({ restaurantId: r.id, type: 'subscription_approved', permission: 'subscription.manage', title: 'Subscription payment approved', body: `Your subscription is active until ${end.toISOString().slice(0, 10)}.`, emailTo: await restaurantAdminEmails(r.id) }, db);
  return { periodStart: start, periodEnd: end };
}

export async function rejectSubscriptionPayment(db: Db, paymentId: number, reason: string, actor: Actor) {
  const p = await one<any>('SELECT * FROM subscription_payments WHERE id=? FOR UPDATE', [paymentId], db);
  if (!p) throw notFound('Subscription payment');
  if (p.status !== 'pending') throw conflict(`Payment already ${p.status}`);
  await exec("UPDATE subscription_payments SET status='rejected', rejection_reason=?, reviewed_by=?, reviewed_at=NOW(3) WHERE id=?", [reason, actor.userId, p.id], db);
  await audit(actor, 'subscription.payment_rejected', 'subscription_payment', p.id, { reason }, db, p.restaurant_id);
  await notify({ restaurantId: p.restaurant_id, type: 'subscription_rejected', permission: 'subscription.manage', title: 'Subscription payment rejected', body: `Reason: ${reason}`, emailTo: await restaurantAdminEmails(p.restaurant_id) }, db);
}

export async function setRestaurantStatus(db: Db, restaurantId: number, action: 'approve' | 'reject' | 'suspend' | 'reactivate', actor: Actor, reason?: string | null) {
  const r = await one<any>('SELECT * FROM restaurants WHERE id=? FOR UPDATE', [restaurantId], db);
  if (!r) throw notFound('Restaurant');
  const sub = await getSubscriptionConfig();
  if (action === 'approve') {
    if (r.status !== 'pending' && r.status !== 'rejected') throw conflict(`Restaurant is ${r.status}`);
    const trialEnd = sub.trialDays > 0 ? new Date(Date.now() + sub.trialDays * 86400000) : (r.subscription_expires_at ?? new Date());
    await exec("UPDATE restaurants SET status='active', status_reason=NULL, approved_at=NOW(3), subscription_expires_at=COALESCE(subscription_expires_at, ?) WHERE id=?", [trialEnd, r.id], db);
  } else if (action === 'reject') {
    if (r.status !== 'pending') throw conflict('Only pending registrations can be rejected');
    await exec("UPDATE restaurants SET status='rejected', status_reason=? WHERE id=?", [reason ?? null, r.id], db);
    await revokeRestaurantAccess(r.id, db);
  } else if (action === 'suspend') {
    if (r.status === 'deleted') throw conflict('Restaurant is deleted');
    const deletion = new Date(Date.now() + sub.dataRetentionDays * 86400000);
    await exec("UPDATE restaurants SET status='suspended', status_reason=?, suspended_at=NOW(3), deletion_scheduled_at=COALESCE(deletion_scheduled_at, ?) WHERE id=?", [reason ?? 'Suspended by platform administrator', deletion, r.id], db);
    await revokeRestaurantAccess(r.id, db);
  } else if (action === 'reactivate') {
    if (!['suspended', 'expired'].includes(r.status)) throw conflict(`Restaurant is ${r.status}`);
    await exec("UPDATE restaurants SET status='active', status_reason=NULL, suspended_at=NULL, deletion_scheduled_at=NULL, deletion_approved=0 WHERE id=?", [r.id], db);
  }
  await audit(actor, `restaurant.${action}`, 'restaurant', r.id, { reason }, db, r.id);
  const titles = { approve: 'Your restaurant has been approved', reject: 'Your registration was not approved', suspend: 'Your restaurant account has been suspended', reactivate: 'Your restaurant account has been reactivated' };
  await notify({ restaurantId: r.id, type: `restaurant_${action}`, title: titles[action], body: reason || '', emailTo: await restaurantAdminEmails(r.id) }, db);
}
