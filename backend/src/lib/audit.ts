import type { Request } from 'express';
import { exec, toJson, type Db, pool } from './db.js';

export interface Actor {
  type: 'staff' | 'super_admin' | 'customer' | 'system';
  userId?: number | null;
  restaurantId?: number | null;
  ip?: string | null;
}

export function actorFromReq(req: Request): Actor {
  const u = req.user;
  return {
    type: u ? (u.isSuperAdmin ? 'super_admin' : 'staff') : req.customer ? 'customer' : 'system',
    userId: u?.id ?? null,
    restaurantId: u?.restaurantId ?? req.customer?.restaurantId ?? null,
    ip: req.ip ?? null,
  };
}

export async function audit(actor: Actor, action: string, entity: string, entityId: string | number | null, data?: unknown, db: Db = pool, restaurantId?: number | null) {
  await exec(
    'INSERT INTO audit_logs (restaurant_id, user_id, actor_type, action, entity, entity_id, data, ip_address) VALUES (?,?,?,?,?,?,?,?)',
    [restaurantId ?? actor.restaurantId ?? null, actor.userId ?? null, actor.type, action, entity, entityId === null ? null : String(entityId), toJson(data ?? null), actor.ip ?? null],
    db,
  );
}
