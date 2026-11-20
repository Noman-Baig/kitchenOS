'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { BrandMark, useBranding } from '@/components/Providers';

export default function ForgotPassword() {
  const b = useBranding();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [err, setErr] = useState('');
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <form className="card stack" style={{ width: 'min(420px, 100%)', padding: 28 }} onSubmit={async (e) => {
        e.preventDefault(); setState('busy'); setErr('');
        try { const r = await api('/auth/forgot-password', { body: { email } }); setEmailEnabled(r.emailEnabled !== false); setState('sent'); }
        catch (x: any) { setErr(x.message); setState('idle'); }
      }}>
        <div className="row" style={{ gap: 10 }}><BrandMark /><strong>{b.softwareName}</strong></div>
        <h1 style={{ margin: '8px 0 0' }}>Reset your password</h1>
        {state === 'sent' ? (
          emailEnabled
            ? <p className="muted">If an active account exists for <strong>{email}</strong>, a reset link is on its way. It works once and expires in 60 minutes. Check your spam folder too.</p>
            : <p className="muted">Email is not set up on this platform yet. Staff: ask your restaurant owner or manager to set a new password under <strong>Dashboard → Staff</strong>. Owners: contact {b.supportEmail || 'platform support'} for a reset link.</p>
        ) : (<>
          <p className="muted small" style={{ margin: 0 }}>Enter the email you sign in with. Staff members can also ask their manager to reset it from the Staff page.</p>
          <label className="field">Email<input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          {err && <div className="error-text" role="alert">{err}</div>}
          <button className="btn btn-primary btn-block" disabled={state === 'busy'}>{state === 'busy' ? 'Sending…' : 'Send reset link'}</button>
        </>)}
        <p className="small muted" style={{ margin: 0 }}><Link className="link" href="/login">Back to sign in</Link></p>
      </form>
    </main>
  );
}
