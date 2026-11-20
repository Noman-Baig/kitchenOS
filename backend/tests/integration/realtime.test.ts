/** WebSocket delivery, reconnect/resync and WebRTC signaling relay against a real server instance. */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { io as ioc, type Socket } from 'socket.io-client';
import { createApp } from '../../src/app.js';
import { createRealtime } from '../../src/realtime/socket.js';
import { exec, one, pool } from '../../src/lib/db.js';
import { hashPassword } from '../../src/routes/auth.js';
import { ensureStorageDirs } from '../../src/services/storage.js';
import { seedDemo } from '../../src/cli/demoData.js';

let server: http.Server; let url = ''; let cookie = ''; let csrf = '';
let token = ''; let qr = ''; let itemId = 0;
const sockets: Socket[] = [];
const waitFor = <T = any>(s: Socket, ev: string, ms = 5000) => new Promise<T>((res, rej) => { const t = setTimeout(() => rej(new Error(`timeout waiting for ${ev}`)), ms); s.once(ev, (d: T) => { clearTimeout(t); res(d); }); });
const connect = (opts: any) => { const s = ioc(url, { path: '/realtime', addTrailingSlash: false, transports: ['websocket'], reconnection: false, ...opts }); sockets.push(s); return new Promise<Socket>((res, rej) => { s.once('connect', () => res(s)); s.once('connect_error', rej); }); };

beforeAll(async () => {
  await ensureStorageDirs();
  await seedDemo(() => undefined);
  await exec("UPDATE users SET password_hash=? WHERE email='owner@demo-bistro.test'", [await hashPassword('RealtimePass123')]);
  const app = createApp();
  server = http.createServer(app);
  await createRealtime(server);
  await new Promise<void>((r) => server.listen(0, r));
  url = `http://192.168.100.198:${(server.address() as AddressInfo).port}`;
  const login = await request(server).post('/api/v1/auth/login').send({ email: 'owner@demo-bistro.test', password: 'RealtimePass123' });
  cookie = (login.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]).join('; ');
  csrf = login.body.csrfToken;
  const rid = (await one<any>("SELECT id FROM restaurants WHERE slug='demo-bistro'")).id;
  qr = (await one<any>("SELECT token FROM qr_tokens WHERE restaurant_id=? AND kind='table' AND active=1 ORDER BY id LIMIT 1", [rid])).token;
  itemId = (await one<any>("SELECT id FROM menu_items WHERE restaurant_id=? AND name='Fresh Lemonade'", [rid])).id;
  token = (await request(server).post(`/api/v1/public/qr/${qr}/session`).send({ name: 'Socket Sam' })).body.data.token;
});
afterAll(async () => { sockets.forEach((s) => s.close()); await new Promise((r) => server.close(r)); await pool.end(); });

describe('realtime', () => {
  it('rejects unauthenticated sockets', async () => {
    await expect(connect({})).rejects.toThrow();
    await expect(connect({ auth: { customerToken: 'bogus' } })).rejects.toThrow();
  });

  it('pushes new orders to staff and status changes to the customer, each with an eventId', async () => {
    const staff = await connect({ extraHeaders: { cookie } });
    const cust = await connect({ auth: { customerToken: token } });
    const newOrder = waitFor(staff, 'order:new');
    const r = await request(server).post('/api/v1/public/session/orders').set('x-customer-session', token).send({ idempotencyKey: 'rt-order-0001', lines: [{ itemId, quantity: 1 }] });
    expect(r.status).toBe(201);
    const ev = await newOrder;
    expect(ev.eventId).toBeTruthy();
    const order = await one<any>('SELECT id FROM orders WHERE public_id=?', [r.body.data.orderId]);
    const upd = waitFor(cust, 'order:updated');
    await request(server).post(`/api/v1/r/orders/${order.id}/status`).set('cookie', cookie).set('x-csrf-token', csrf).send({ status: 'accepted' });
    expect((await upd).status).toBe('accepted');
  });

  it('after a disconnect the customer reconnects and resyncs state from the server', async () => {
    const c1 = await connect({ auth: { customerToken: token } });
    c1.close();
    const c2 = await connect({ auth: { customerToken: token } });
    expect(c2.connected).toBe(true);
    const state = await request(server).get('/api/v1/public/session').set('x-customer-session', token);
    expect(state.body.data.bill.orders.length).toBe(1);
    expect(state.body.data.bill.orders[0].status).toBe('accepted');
  });

  it('relays WebRTC call signaling between customer and staff and records the call', async () => {
    const staff = await connect({ extraHeaders: { cookie } });
    const cust = await connect({ auth: { customerToken: token } });
    const incoming = waitFor<any>(staff, 'call:incoming');
    const start: any = await new Promise((res) => cust.emit('call:start', {}, res));
    expect(start.ok, JSON.stringify(start)).toBe(true);
    const inc = await incoming;
    expect(inc.callId).toBe(start.callId);
    const accepted = waitFor(cust, 'call:accepted');
    const ans: any = await new Promise((res) => staff.emit('call:answer', { callId: inc.callId, accept: true }, res));
    expect(ans.ok).toBe(true);
    await accepted;
    const sig = waitFor<any>(staff, 'call:signal');
    cust.emit('call:signal', { callId: start.callId, signal: { type: 'offer', sdp: 'v=0...' } });
    expect((await sig).signal.type).toBe('offer');
    const ended = waitFor(staff, 'call:ended');
    cust.emit('call:hangup', { callId: start.callId });
    await ended;
    const rec = await one<any>('SELECT status, staff_user_id, answered_at FROM call_records WHERE public_id=?', [start.callId]);
    expect(rec.status).toBe('ended');
    expect(rec.answered_at).toBeTruthy();
  });

  it('a socket outside the call cannot inject signals', async () => {
    const other = await connect({ extraHeaders: { cookie } });
    let got = false;
    other.on('call:signal', () => { got = true; });
    other.emit('call:signal', { callId: 'not-mine', signal: { x: 1 } });
    await new Promise((r) => setTimeout(r, 200));
    expect(got).toBe(false);
  });
});
