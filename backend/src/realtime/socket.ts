import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { parse as parseCookie } from 'cookie';
import { config } from '../config.js';
import { exec, j, one, q } from '../lib/db.js';
import { sha256, uuid } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';
import { PERMISSIONS, hasPermission, type Permission } from '../lib/permissions.js';
import { attachIo, emit, rooms } from './bus.js';
import { findSessionByToken } from '../middleware/customer.js';
import { computeAvailability } from '../services/restaurantStatus.js';
import { restaurantSettings } from '../services/settings.js';

type StaffData = { kind: 'staff'; userId: number; restaurantId: number | null; isSuperAdmin: boolean; permissions: string[]; name: string };
type CustData = { kind: 'customer'; sessionId: number; restaurantId: number; tableId: number | null; name: string };

/** Active call bookkeeping (per process; signaling is relayed through rooms so it works across nodes with the Redis adapter). */
const callTimers = new Map<string, NodeJS.Timeout>();

export async function createRealtime(server: HttpServer) {
  const io = new Server(server, {
    path: '/realtime',
    addTrailingSlash: false,
    cors: { origin: config.corsOrigins, credentials: true },
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000, skipMiddlewares: false },
    pingInterval: 20000, pingTimeout: 20000, maxHttpBufferSize: 256 * 1024,
  });
  if (config.redisUrl) {
    const pub = new Redis(config.redisUrl); const sub = pub.duplicate();
    io.adapter(createAdapter(pub, sub));
    logger.info('socket.io using Redis adapter');
  }
  attachIo(io);

  io.use(async (socket, next) => {
    try {
      const auth = socket.handshake.auth || {};
      if (auth.customerToken) {
        const s = await findSessionByToken(String(auth.customerToken));
        if (!s || s.status !== 'active') return next(new Error('SESSION_INVALID'));
        const r = await one<any>('SELECT * FROM restaurants WHERE id=?', [s.restaurant_id]);
        if (!(await computeAvailability(r)).available) return next(new Error('RESTAURANT_UNAVAILABLE'));
        socket.data = { kind: 'customer', sessionId: s.id, restaurantId: s.restaurant_id, tableId: s.table_id, name: s.customer_name } satisfies CustData;
        return next();
      }
      const cookies = parseCookie(socket.handshake.headers.cookie || '');
      const token = cookies[config.session.cookieName];
      if (!token) return next(new Error('UNAUTHORIZED'));
      const row = await one<any>(`SELECT u.id, u.name, u.restaurant_id, u.is_super_admin, u.active, r.permissions FROM auth_sessions s JOIN users u ON u.id=s.user_id LEFT JOIN roles r ON r.id=u.role_id
        WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>NOW(3)`, [sha256(token)]);
      if (!row || !row.active) return next(new Error('UNAUTHORIZED'));
      if (row.restaurant_id) {
        const r = await one<any>('SELECT * FROM restaurants WHERE id=?', [row.restaurant_id]);
        if (!(await computeAvailability(r)).available) return next(new Error('RESTAURANT_UNAVAILABLE'));
      }
      socket.data = { kind: 'staff', userId: row.id, restaurantId: row.restaurant_id, isSuperAdmin: !!row.is_super_admin, permissions: row.is_super_admin ? ['*'] : j(row.permissions, []), name: row.name } satisfies StaffData;
      next();
    } catch (err) { next(err as Error); }
  });

  io.on('connection', (socket: Socket) => {
    const d = socket.data as StaffData | CustData;
    if (d.kind === 'customer') {
      socket.join([rooms.session(d.sessionId), rooms.menu(d.restaurantId), `cust:${d.restaurantId}`]);
    } else {
      socket.join(rooms.user(d.userId));
      if (d.isSuperAdmin) socket.join(rooms.platform());
      if (d.restaurantId) {
        socket.join([rooms.restaurant(d.restaurantId), rooms.menu(d.restaurantId)]);
        for (const p of Object.keys(PERMISSIONS) as Permission[]) if (hasPermission(d.permissions, p)) socket.join(rooms.staffPerm(d.restaurantId, p));
      }
    }

    // Kitchen screens subscribe to specific stations.
    socket.on('kds:subscribe', (stationIds: unknown) => {
      if (d.kind !== 'staff' || !d.restaurantId || !hasPermission(d.permissions, 'kitchen.view')) return;
      const ids = Array.isArray(stationIds) ? stationIds.filter((x) => Number.isInteger(x)).slice(0, 20) : [];
      for (const id of ids) socket.join(rooms.station(d.restaurantId, id));
      socket.join(rooms.station(d.restaurantId, null));
    });

    // Lightweight presence for "agent is typing".
    socket.on('chat:typing', (p: { sessionId?: number }) => {
      if (d.kind === 'customer') emit(rooms.staffPerm(d.restaurantId, 'support.handle'), 'chat:typing', { sessionId: d.sessionId });
      else if (d.restaurantId && p?.sessionId) emit(rooms.session(Number(p.sessionId)), 'chat:typing', { staff: true });
    });

    /* ------------------------ WebRTC voice signaling ------------------------ */
    socket.on('call:start', async (_p, ack?: (r: unknown) => void) => {
      try {
        if (d.kind !== 'customer') return ack?.({ ok: false, error: 'Only customers can start calls' });
        const busy = await one<any>("SELECT id FROM call_records WHERE session_id=? AND status IN ('ringing','accepted')", [d.sessionId]);
        if (busy) return ack?.({ ok: false, error: 'A call is already in progress' });
        const r = await one<any>('SELECT * FROM restaurants WHERE id=?', [d.restaurantId]);
        const s = restaurantSettings(r);
        const receivers = await q<any>(`SELECT u.id FROM users u JOIN roles ro ON ro.id=u.role_id WHERE u.restaurant_id=? AND u.active=1
             AND (u.id IN (?) OR ro.system_key IN (?)) AND (JSON_CONTAINS(ro.permissions, '"calls.receive"') OR JSON_CONTAINS(ro.permissions, '"*"'))`,
          [d.restaurantId, s.callReceiverUserIds.length ? s.callReceiverUserIds : [0], s.callReceiverRoleKeys.length ? s.callReceiverRoleKeys : ['']]);
        if (!receivers.length) return ack?.({ ok: false, error: 'No staff are configured to receive calls', fallbackPhone: s.fallbackPhone || r.contact_phone });
        const callId = uuid();
        await exec('INSERT INTO call_records (public_id, restaurant_id, session_id, table_id) VALUES (?,?,?,?)', [callId, d.restaurantId, d.sessionId, d.tableId]);
        socket.join(`call:${callId}`);
        const table = d.tableId ? await one<any>('SELECT name FROM dining_tables WHERE id=?', [d.tableId]) : null;
        for (const rcv of receivers) emit(rooms.user(rcv.id), 'call:incoming', { callId, customer: d.name, table: table?.name ?? 'Online order', sessionId: d.sessionId });
        callTimers.set(callId, setTimeout(async () => {
          const c = await one<any>('SELECT status FROM call_records WHERE public_id=?', [callId]);
          if (c?.status === 'ringing') {
            await exec("UPDATE call_records SET status='missed', ended_at=NOW(3), end_reason='timeout' WHERE public_id=?", [callId]);
            emit(`call:${callId}`, 'call:ended', { callId, reason: 'missed', fallbackPhone: s.fallbackPhone || r.contact_phone });
            for (const rcv of receivers) emit(rooms.user(rcv.id), 'call:cancelled', { callId, reason: 'missed' });
            await exec("INSERT INTO support_requests (restaurant_id, session_id, table_id, type, message) VALUES (?,?,?,'call_back','Missed voice call — please call back or visit the table')", [d.restaurantId, d.sessionId, d.tableId]);
            emit(rooms.staffPerm(d.restaurantId, 'support.handle'), 'support:new', { type: 'call_back', tableId: d.tableId });
          }
          callTimers.delete(callId);
        }, config.webrtc.callTimeoutSeconds * 1000));
        ack?.({ ok: true, callId });
      } catch (err) { logger.error({ err }, 'call:start'); ack?.({ ok: false, error: 'Call failed' }); }
    });

    socket.on('call:answer', async (p: { callId?: string; accept?: boolean }, ack?: (r: unknown) => void) => {
      if (d.kind !== 'staff' || !d.restaurantId || !hasPermission(d.permissions, 'calls.receive') || !p?.callId) return ack?.({ ok: false });
      const c = await one<any>('SELECT * FROM call_records WHERE public_id=? AND restaurant_id=?', [p.callId, d.restaurantId]);
      if (!c || c.status !== 'ringing') return ack?.({ ok: false, error: 'Call no longer available' });
      if (!p.accept) {
        emit(rooms.user(d.userId), 'call:cancelled', { callId: p.callId, reason: 'declined_by_you' });
        return ack?.({ ok: true });
      }
      const upd = await exec("UPDATE call_records SET status='accepted', staff_user_id=?, answered_at=NOW(3) WHERE public_id=? AND status='ringing'", [d.userId, p.callId]);
      if (!upd.affectedRows) return ack?.({ ok: false, error: 'Answered by someone else' });
      clearTimeout(callTimers.get(p.callId)); callTimers.delete(p.callId);
      socket.join(`call:${p.callId}`);
      emit(`call:${p.callId}`, 'call:accepted', { callId: p.callId, staff: d.name });
      emit(rooms.staffPerm(d.restaurantId, 'calls.receive'), 'call:cancelled', { callId: p.callId, reason: 'answered', by: d.name });
      ack?.({ ok: true });
    });

    /** Relay SDP offers/answers and ICE candidates only between members of the same call room. */
    socket.on('call:signal', (p: { callId?: string; signal?: unknown }) => {
      if (!p?.callId || !socket.rooms.has(`call:${p.callId}`)) return;
      const size = JSON.stringify(p.signal ?? null).length;
      if (size > 64 * 1024) return;
      socket.to(`call:${p.callId}`).emit('call:signal', { callId: p.callId, signal: p.signal, from: d.kind });
    });

    socket.on('call:hangup', async (p: { callId?: string; reason?: string }) => {
      if (!p?.callId) return;
      const c = await one<any>('SELECT * FROM call_records WHERE public_id=?', [p.callId]);
      if (!c || c.restaurant_id !== d.restaurantId) return;
      const isMember = socket.rooms.has(`call:${p.callId}`);
      if (!isMember) return;
      const status = c.status === 'ringing' ? (d.kind === 'staff' ? 'rejected' : 'ended') : c.status === 'accepted' ? 'ended' : c.status;
      await exec('UPDATE call_records SET status=?, ended_at=COALESCE(ended_at, NOW(3)), end_reason=? WHERE id=?', [status, String(p.reason || d.kind + '_hangup').slice(0, 120), c.id]);
      clearTimeout(callTimers.get(p.callId)); callTimers.delete(p.callId);
      emit(`call:${p.callId}`, 'call:ended', { callId: p.callId, reason: p.reason || 'hangup' });
      if (c.status === 'ringing') emit(rooms.staffPerm(c.restaurant_id, 'calls.receive'), 'call:cancelled', { callId: p.callId, reason: 'caller_hung_up' });
    });

    socket.on('call:failed', async (p: { callId?: string }) => {
      if (!p?.callId || !socket.rooms.has(`call:${p.callId}`)) return;
      await exec("UPDATE call_records SET status='failed', ended_at=NOW(3), end_reason='webrtc_failed' WHERE public_id=? AND status IN ('ringing','accepted')", [p.callId]);
      emit(`call:${p.callId}`, 'call:ended', { callId: p.callId, reason: 'failed' });
    });

    socket.on('disconnecting', async () => {
      for (const room of socket.rooms) {
        if (!room.startsWith('call:')) continue;
        const callId = room.slice(5);
        await exec("UPDATE call_records SET status=IF(status='ringing','ended','ended'), ended_at=NOW(3), end_reason='disconnected' WHERE public_id=? AND status IN ('ringing','accepted')", [callId]).catch(() => undefined);
        emit(room, 'call:ended', { callId, reason: 'disconnected' });
      }
    });
  });
  return io;
}
