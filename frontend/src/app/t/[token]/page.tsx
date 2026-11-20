'use client';
import { use, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { CustomerApp } from '@/components/customer/CustomerApp';
import { useToast } from '@/components/ui';

/**
 * Table QR entry. Recovery order: token saved on this device → HttpOnly cookie (server) → join by PIN/phone → new session.
 * Sessions live on the server; local storage only caches the opaque token.
 */
export default function TablePage({ params }: { params: Promise<{ token: string }> }) {
  const { token: qr } = use(params);
  const toast = useToast();
  const key = `um_cs_${qr}`;
  const [info, setInfo] = useState<any>(null);
  const [err, setErr] = useState<any>(null);
  const [session, setSession] = useState<{ token: string; greeting?: string | null } | null>(null);
  const [closedToken, setClosedToken] = useState<string | null>(null);
  const [f, setF] = useState({ name: '', phone: '', recognitionOptIn: false, marketingOptIn: false, joinPin: '' });
  const [needPin, setNeedPin] = useState(false);
  const [busy, setBusy] = useState(false);

  const start = useCallback(async (body: any) => {
    const r = await api(`/public/qr/${qr}/session`, { body });
    if (r.data.state === 'none') return;
    if (r.data.state === 'closed') { setClosedToken(r.data.token); setSession({ token: r.data.token }); return; }
    try { localStorage.setItem(key, r.data.token); } catch { /* private mode: cookie still recovers */ }
    setSession({ token: r.data.token, greeting: r.data.greeting });
  }, [qr, key]);

  useEffect(() => {
    (async () => {
      try {
        const i = await api(`/public/qr/${qr}`);
        if (i.data.kind === 'online') { location.replace(`/r/${i.data.restaurant.slug}`); return; }
        setInfo(i.data);
        if (!i.data.restaurant.available) return;
        let saved: string | null = null;
        try { saved = localStorage.getItem(key); } catch { /* */ }
        if (saved || i.data.hasSessionOnDevice) await start({ name: 'Guest', existingToken: saved || undefined, recoverOnly: true }).catch(() => { try { localStorage.removeItem(key); } catch { /* */ } });
      } catch (e: any) { setErr(e); }
    })();
  }, [qr, key, start]);

  const ended = useCallback(() => { try { localStorage.removeItem(key); } catch { /* */ } setSession(null); setClosedToken(null); }, [key]);

  if (err) return <main className="cust" style={{ padding: 24 }}><h1>QR code not valid</h1><p className="muted">{err.message}</p></main>;
  if (!info) return <main className="cust" style={{ padding: 24 }}><div className="skeleton" /></main>;
  const r = info.restaurant;
  if (!r.available) return (
    <main className="cust" style={{ padding: 24 }}>
      <h1>{r.name}</h1><div className="alert alert-warning">Ordering is unavailable right now. Please ask a staff member for help.</div>
      {r.suspension?.supportEmail && <p className="small muted mt">Support: {r.suspension.supportEmail}</p>}
    </main>
  );
  if (session) return <CustomerApp key={session.token} token={session.token} greeting={session.greeting} onEnded={ended} />;
  void closedToken;
  return (
    <main className="cust">
      {r.bannerUrl && <img src={r.bannerUrl} alt="" style={{ width: '100%', height: 160, objectFit: 'cover' }} />}
      <div style={{ padding: 20 }} className="stack">
        <div className="row">{r.logoUrl && <img src={r.logoUrl} alt="" width={48} height={48} style={{ borderRadius: 12 }} />}<div><h1 style={{ margin: 0 }}>{r.name}</h1><div className="muted">{info.table.name}</div></div></div>
        <form className="card stack" onSubmit={async (e) => {
          e.preventDefault(); setBusy(true);
          try { await start({ name: f.name.trim(), phone: f.phone.trim() || null, recognitionOptIn: f.recognitionOptIn, marketingOptIn: f.marketingOptIn, joinPin: needPin && f.joinPin ? f.joinPin : undefined, startNew: true }); }
          catch (x: any) { if (x.details?.code === 'TABLE_OCCUPIED') { setNeedPin(true); toast(x.message, 'error'); } else toast(x.message, 'error'); }
          finally { setBusy(false); }
        }}>
          <h2 style={{ margin: 0 }}>Welcome!</h2>
          <label className="field">Your name *<input className="input" required maxLength={190} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="given-name" /></label>
          <label className="field">Phone (optional)<input className="input" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" /><span className="hint">Lets us recognise you next time and link loyalty points.</span></label>
          {f.phone && <><label className="check"><input type="checkbox" checked={f.recognitionOptIn} onChange={(e) => setF({ ...f, recognitionOptIn: e.target.checked })} /> Remember me on future visits</label>
            <label className="check"><input type="checkbox" checked={f.marketingOptIn} onChange={(e) => setF({ ...f, marketingOptIn: e.target.checked })} /> Send me offers (you can opt out any time)</label></>}
          {needPin && <label className="field">Table PIN (shown on the first guest’s phone)<input className="input" inputMode="numeric" maxLength={4} pattern="\d{4}" value={f.joinPin} onChange={(e) => setF({ ...f, joinPin: e.target.value.replace(/\D/g, '') })} /></label>}
          <button className="btn btn-primary btn-lg" disabled={busy || !f.name.trim()}>{needPin ? 'Join table' : 'View menu & order'}</button>
          <p className="tiny muted" style={{ margin: 0 }}>By continuing you agree to the <a className="link" href="/terms">Terms</a> and <a className="link" href="/privacy">Privacy Policy</a>.</p>
        </form>
      </div>
    </main>
  );
}
