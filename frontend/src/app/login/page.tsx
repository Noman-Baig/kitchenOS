'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { BrandMark, useBranding } from '@/components/Providers';

export default function Login() {
  const b = useBranding();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <form className="card stack" style={{ width: 'min(400px, 100%)', padding: 28 }} onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr('');
        try {
          const r = await api('/auth/login', { body: { email, password } });
          const next = new URLSearchParams(location.search).get('next');
          location.href = next && next.startsWith('/') && !next.startsWith('//') ? next : r.isSuperAdmin ? '/admin' : '/dashboard';
        } catch (x: any) { setErr(x.message); setBusy(false); }
      }}>
        <div className="row" style={{ gap: 10 }}><BrandMark /><strong>{b.softwareName}</strong></div>
        <h1 style={{ margin: '8px 0 0' }}>Sign in</h1>
        <label className="field">Email<input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field">Password<input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {err && <div className="error-text" role="alert">{err}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="small muted" style={{ margin: 0 }}>New restaurant? <Link className="link" href="/register">Create an account</Link>. <Link className="link" href="/forgot-password">Forgot your password?</Link></p>
      </form>
    </main>
  );
}
