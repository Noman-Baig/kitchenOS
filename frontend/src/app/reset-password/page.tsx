'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { BrandMark, useBranding } from '@/components/Providers';

export default function ResetPassword() {
  const b = useBranding();
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  useEffect(() => {
    const t = new URLSearchParams(location.search).get('token') || '';
    setToken(t);
    // remove the token from the address bar and browser history
    if (t) history.replaceState(null, '', '/reset-password');
  }, []);
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <form className="card stack" style={{ width: 'min(420px, 100%)', padding: 28 }} onSubmit={async (e) => {
        e.preventDefault(); setErr('');
        if (password !== confirm) return setErr('The two passwords do not match');
        setState('busy');
        try { await api('/auth/reset-password', { body: { token, password } }); setState('done'); }
        catch (x: any) { setErr(x.message); setState('idle'); }
      }}>
        <div className="row" style={{ gap: 10 }}><BrandMark /><strong>{b.softwareName}</strong></div>
        <h1 style={{ margin: '8px 0 0' }}>Choose a new password</h1>
        {state === 'done' ? (<>
          <p className="muted">Your password has been changed and all other sessions were signed out.</p>
          <Link className="btn btn-primary btn-block" href="/login">Sign in</Link>
        </>) : !token ? (
          <p className="muted">This page needs the link from your reset email. <Link className="link" href="/forgot-password">Request a new link</Link>.</p>
        ) : (<>
          <label className="field">New password<input className="input" type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} /><span className="small muted">At least 10 characters, with letters and numbers.</span></label>
          <label className="field">Confirm password<input className="input" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
          {err && <div className="error-text" role="alert">{err}</div>}
          <button className="btn btn-primary btn-block" disabled={state === 'busy'}>{state === 'busy' ? 'Saving…' : 'Set new password'}</button>
        </>)}
      </form>
    </main>
  );
}
