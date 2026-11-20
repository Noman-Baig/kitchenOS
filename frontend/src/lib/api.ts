'use client';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) { super(message); }
}

function csrfToken() {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(/(?:^|; )um_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

let customerToken: string | null = null;
export function setCustomerToken(t: string | null) { customerToken = t; }

type Opts = { method?: string; body?: unknown; form?: FormData; customer?: boolean; signal?: AbortSignal; raw?: boolean };

/** Same-origin API client. Staff auth = HttpOnly cookie + CSRF header; customers = opaque session header. */
export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const method = opts.method || (opts.body || opts.form ? 'POST' : 'GET');
  if (method !== 'GET') headers['x-csrf-token'] = csrfToken();
  if (opts.customer && customerToken) headers['x-customer-session'] = customerToken;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.body); }
  const res = await fetch(`/api/v1${path}`, { method, headers, body, credentials: 'same-origin', signal: opts.signal, cache: 'no-store' });
  if (opts.raw) { if (!res.ok) throw new ApiError(res.status, 'HTTP', res.statusText); return res as any; }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const e = (data as any)?.error || {};
    if (res.status === 402 && !opts.customer && typeof window !== 'undefined' && !location.pathname.startsWith('/suspended') && !location.pathname.startsWith('/dashboard/subscription')) {
      sessionStorage.setItem('um_suspension', JSON.stringify(e.details || {}));
      location.href = '/suspended';
    }
    throw new ApiError(res.status, e.code || 'HTTP', e.message || res.statusText, e.details);
  }
  return data as T;
}

export const apiUrl = (path: string) => `/api/v1${path}`;

export function idemKey() {
  return (crypto as any).randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function download(path: string, filename: string) {
  const res = await api<Response>(path, { raw: true });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
