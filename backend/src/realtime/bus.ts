import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import { Emitter } from '@socket.io/redis-emitter';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';

/**
 * Event bus used by HTTP handlers and background workers.
 * - In the API process it emits through the attached socket.io server (with the Redis adapter when REDIS_URL is set).
 * - In a standalone worker process it emits through @socket.io/redis-emitter (requires REDIS_URL).
 * Every event carries an `eventId` so clients can de-duplicate after reconnects.
 */
let io: Server | null = null;
let emitter: Emitter | null = null;

export function attachIo(server: Server) { io = server; }

export function initWorkerEmitter() {
  if (!config.redisUrl) {
    logger.warn('REDIS_URL not set: a standalone worker cannot push realtime events; notifications are still stored and delivered on next fetch.');
    return;
  }
  emitter = new Emitter(new Redis(config.redisUrl));
}

export const rooms = {
  restaurant: (rid: number) => `r:${rid}`,
  staffPerm: (rid: number, perm: string) => `r:${rid}:p:${perm}`,
  station: (rid: number, stationId: number | null) => `r:${rid}:st:${stationId ?? 0}`,
  user: (uid: number) => `u:${uid}`,
  session: (sid: number) => `cs:${sid}`,
  menu: (rid: number) => `menu:${rid}`,
  platform: () => 'platform',
};

export function emit(room: string | string[], event: string, data: Record<string, unknown> = {}) {
  const payload = { ...data, eventId: randomUUID(), at: new Date().toISOString() };
  const target: any = io ?? emitter;
  if (!target) return;
  try {
    target.to(room).emit(event, payload);
  } catch (err) {
    logger.error({ err, event }, 'emit failed');
  }
}

/** Force-disconnect sockets (used on suspension / logout). */
export async function disconnectRoom(room: string) {
  if (io) io.in(room).disconnectSockets(true);
  else if (emitter) emitter.in(room).disconnectSockets(true);
}
