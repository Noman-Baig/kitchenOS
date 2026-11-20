import { one, q, exec, type Db, pool } from '../lib/db.js';
import { disconnectRoom, rooms } from '../realtime/bus.js';
import { getBranding, getSubscriptionConfig } from './settings.js';

export type Availability = {
  available: boolean;
  state: 'active' | 'grace' | 'expired' | 'suspended' | 'pending' | 'rejected' | 'deleted';
  expiresAt: Date | null;
  graceEndsAt: Date | null;
  reason: string | null;
  deletionScheduledAt: Date | null;
};

export async function computeAvailability(r: any): Promise<Availability> {
  const sub = await getSubscriptionConfig();
  const grace = r.grace_days ?? sub.defaultGraceDays;
  const expiresAt = r.subscription_expires_at ? new Date(r.subscription_expires_at) : null;
  const graceEndsAt = expiresAt ? new Date(expiresAt.getTime() + grace * 86400000) : null;
  const base = { expiresAt, graceEndsAt, reason: r.status_reason ?? null, deletionScheduledAt: r.deletion_scheduled_at ? new Date(r.deletion_scheduled_at) : null };
  if (r.status !== 'active') return { ...base, available: false, state: r.status };
  const now = Date.now();
  if (!expiresAt || expiresAt.getTime() > now) return { ...base, available: true, state: 'active' };
  if (graceEndsAt && graceEndsAt.getTime() > now) return { ...base, available: true, state: 'grace' };
  return { ...base, available: false, state: 'expired' };
}

/** Public-safe suspension payload for the professional suspension page. */
export async function suspensionInfo(r: any, a: Availability) {
  const b = await getBranding();
  const sub = await getSubscriptionConfig();
  return {
    restaurantName: r.name,
    state: a.state,
    reason: a.state === 'expired' ? 'Subscription expired and the grace period has ended.' : (a.reason || (a.state === 'pending' ? 'Registration is awaiting approval.' : 'Account is not active.')),
    supportEmail: b.supportEmail,
    supportPhone: b.supportPhone,
    renewalInstructions: sub.paymentInstructions,
    deletionScheduledAt: a.deletionScheduledAt,
    deletionWarning: a.deletionScheduledAt
      ? `Your restaurant data is scheduled for deletion in ${Math.max(1, Math.round(sub.dataRetentionDays / 30))} months if your account is not reactivated.`
      : null,
  };
}

/** Invalidate every staff session and customer session for a restaurant, and drop its sockets. */
export async function revokeRestaurantAccess(restaurantId: number, db: Db = pool) {
  await exec('UPDATE auth_sessions s JOIN users u ON u.id=s.user_id SET s.revoked_at=NOW(3) WHERE u.restaurant_id=? AND s.revoked_at IS NULL', [restaurantId], db);
  await exec("UPDATE customer_sessions SET status='expired', closed_at=NOW(3) WHERE restaurant_id=? AND status='active'", [restaurantId], db);
  await disconnectRoom(rooms.restaurant(restaurantId));
  await disconnectRoom(`cust:${restaurantId}`);
}

export async function loadRestaurant(id: number, db: Db = pool) {
  return one<any>('SELECT * FROM restaurants WHERE id=?', [id], db);
}

export async function restaurantPublicAssets(r: any) {
  const ids = [r.logo_file_id, r.banner_file_id].filter(Boolean);
  const files = ids.length ? await q<any>('SELECT id, public_id FROM files WHERE id IN (?)', [ids]) : [];
  const url = (id: number | null) => {
    const f = files.find((x) => x.id === id);
    return f ? `/api/v1/files/${f.public_id}` : null;
  };
  return { logoUrl: url(r.logo_file_id), bannerUrl: url(r.banner_file_id) };
}
