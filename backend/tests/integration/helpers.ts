import request from 'supertest';
import sharp from 'sharp';
import type { Express } from 'express';

export async function pngBuffer(w = 300, h = 200, color = '#2266aa') {
  return sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
}
export async function signatureDataUrl() {
  return `data:image/png;base64,${(await pngBuffer(400, 150, '#ffffff')).toString('base64')}`;
}

/** Cookie-keeping client that attaches the CSRF header automatically. */
export class Client {
  agent: ReturnType<typeof request.agent>;
  csrf = '';
  constructor(public app: Express) { this.agent = request.agent(app); }
  async login(email: string, password: string) {
    const r = await this.agent.post('/api/v1/auth/login').send({ email, password });
    if (r.status !== 200) throw new Error(`login failed ${r.status} ${JSON.stringify(r.body)}`);
    this.csrf = r.body.csrfToken;
    return r;
  }
  get(url: string) { return this.agent.get(url); }
  post(url: string, body?: unknown) { return this.agent.post(url).set('x-csrf-token', this.csrf).send(body as any); }
  patch(url: string, body?: unknown) { return this.agent.patch(url).set('x-csrf-token', this.csrf).send(body as any); }
  put(url: string, body?: unknown) { return this.agent.put(url).set('x-csrf-token', this.csrf).send(body as any); }
  del(url: string) { return this.agent.delete(url).set('x-csrf-token', this.csrf); }
  upload(url: string) { return this.agent.post(url).set('x-csrf-token', this.csrf); }
}

export class Customer {
  token = '';
  constructor(public app: Express) {}
  get(url: string) { return request(this.app).get(url).set('x-customer-session', this.token); }
  post(url: string, body?: unknown) { return request(this.app).post(url).set('x-customer-session', this.token).send(body as any); }
  patch(url: string, body?: unknown) { return request(this.app).patch(url).set('x-customer-session', this.token).send(body as any); }
  upload(url: string) { return request(this.app).post(url).set('x-customer-session', this.token); }
}

export const key = () => `k-${Math.random().toString(36).slice(2)}-${Date.now()}`;
