'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { BrandMark, useBranding } from '@/components/Providers';
import { SignaturePad } from '@/components/SignaturePad';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'SAR', 'PKR', 'INR', 'CAD', 'AUD', 'QAR', 'KWD', 'BHD', 'OMR', 'EGP', 'TRY', 'MYR', 'SGD', 'JPY', 'ZAR', 'NGN', 'KES', 'BDT', 'LKR', 'NZD', 'CHF'];

export default function Register() {
  const b = useBranding();
  const [step, setStep] = useState(1);
  const [plans, setPlans] = useState<any[]>([]);
  const [agreement, setAgreement] = useState<any>(null);
  const zones = useMemo(() => { try { return (Intl as any).supportedValuesOf('timeZone') as string[]; } catch { return ['UTC']; } }, []);
  const [r, setR] = useState({ name: '', legalName: '', country: '', city: '', address: '', timezone: 'UTC', currency: 'USD', phone: '', email: '', planId: '' });
  const [a, setA] = useState({ name: '', email: '', password: '', phone: '' });
  const [sig, setSig] = useState<{ signerName: string; signerTitle: string; dataUrl: string | null; accepted: boolean }>({ signerName: '', signerTitle: '', dataUrl: null, accepted: false });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [done, setDone] = useState('');
  useEffect(() => {
    setR((x) => ({ ...x, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', country: (navigator.language.split('-')[1] || '').toUpperCase() }));
    api('/public/plans').then((p) => setPlans(p.data)).catch(() => undefined);
    api('/public/agreement/current').then((p) => setAgreement(p.data)).catch(() => undefined);
  }, []);
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const res = await api('/auth/register', { body: {
        restaurant: { ...r, planId: r.planId ? Number(r.planId) : null, legalName: r.legalName || null, city: r.city || null, address: r.address || null, phone: r.phone || null },
        admin: { ...a, phone: a.phone || null },
        agreement: { agreementId: agreement.id, signerName: sig.signerName, signerTitle: sig.signerTitle || null, signatureDataUrl: sig.dataUrl, accepted: true },
      } });
      setDone(res.message);
    } catch (x: any) {
      const fe = x.details?.fieldErrors; setErr(x.message + (fe ? ': ' + Object.keys(fe).join(', ') : ''));
    } finally { setBusy(false); }
  };
  if (done) return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="card stack" style={{ maxWidth: 520 }}><h1>Registration received</h1><p>{done}</p><p className="muted">Next: open your dashboard → Subscription, pay for your plan and upload the payment screenshot. We will notify you when your account is active.</p><Link href="/dashboard/subscription" className="btn btn-primary">Go to subscription</Link></div>
    </main>
  );
  const s1 = r.name && r.country.length === 2 && r.email && r.currency && r.timezone;
  const s2 = a.name && a.email && a.password.length >= 10;
  const s3 = sig.signerName && sig.dataUrl && sig.accepted && agreement;
  return (
    <main style={{ minHeight: '100vh', padding: '32px 16px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div className="row mb" style={{ gap: 10 }}><BrandMark /><strong>{b.softwareName}</strong><span className="grow" /><Link href="/login" className="small link">Already registered? Sign in</Link></div>
        <h1>Register your restaurant</h1>
        <div className="status-steps" aria-label={`Step ${step} of 3`}>{[1, 2, 3].map((i) => <div key={i} className={`step ${i <= step ? 'done' : ''}`} />)}</div>
        <div className="card">
          {step === 1 && <div className="form-grid">
            <h2 className="full">Restaurant details</h2>
            <label className="field">Restaurant name *<input className="input" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} /></label>
            <label className="field">Legal / company name<input className="input" value={r.legalName} onChange={(e) => setR({ ...r, legalName: e.target.value })} /></label>
            <label className="field">Country (2-letter code) *<input className="input" maxLength={2} value={r.country} onChange={(e) => setR({ ...r, country: e.target.value.toUpperCase() })} placeholder="e.g. AE, PK, GB, US" /></label>
            <label className="field">City<input className="input" value={r.city} onChange={(e) => setR({ ...r, city: e.target.value })} /></label>
            <label className="field full">Address<input className="input" value={r.address} onChange={(e) => setR({ ...r, address: e.target.value })} /></label>
            <label className="field">Timezone *<select className="input" value={r.timezone} onChange={(e) => setR({ ...r, timezone: e.target.value })}>{zones.map((z) => <option key={z}>{z}</option>)}</select></label>
            <label className="field">Currency *<select className="input" value={r.currency} onChange={(e) => setR({ ...r, currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select><span className="hint">Cannot be changed later without support.</span></label>
            <label className="field">Restaurant email *<input className="input" type="email" value={r.email} onChange={(e) => setR({ ...r, email: e.target.value })} /></label>
            <label className="field">Phone<input className="input" value={r.phone} onChange={(e) => setR({ ...r, phone: e.target.value })} /></label>
            {plans.length > 0 && <label className="field full">Plan<select className="input" value={r.planId} onChange={(e) => setR({ ...r, planId: e.target.value })}><option value="">Choose later</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {Number(p.price).toFixed(2)} {p.currency} / {p.duration_days} days</option>)}</select></label>}
            <div className="full row" style={{ justifyContent: 'flex-end' }}><button className="btn btn-primary" disabled={!s1} onClick={() => setStep(2)}>Continue</button></div>
          </div>}
          {step === 2 && <div className="form-grid">
            <h2 className="full">Owner account</h2>
            <label className="field">Full name *<input className="input" value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} /></label>
            <label className="field">Phone<input className="input" value={a.phone} onChange={(e) => setA({ ...a, phone: e.target.value })} /></label>
            <label className="field">Login email *<input className="input" type="email" autoComplete="username" value={a.email} onChange={(e) => setA({ ...a, email: e.target.value })} /></label>
            <label className="field">Password *<input className="input" type="password" autoComplete="new-password" value={a.password} onChange={(e) => setA({ ...a, password: e.target.value })} /><span className="hint">At least 10 characters with letters and numbers.</span></label>
            <div className="full row-between"><button className="btn" onClick={() => setStep(1)}>Back</button><button className="btn btn-primary" disabled={!s2} onClick={() => { setSig((s) => ({ ...s, signerName: s.signerName || a.name })); setStep(3); }}>Continue</button></div>
          </div>}
          {step === 3 && <div className="stack">
            <h2>{agreement?.title || 'Platform agreement'} {agreement && <span className="badge">v{agreement.version}</span>}</h2>
            <div style={{ maxHeight: 280, overflowY: 'auto', whiteSpace: 'pre-wrap', border: '1px solid var(--border)', borderRadius: 8, padding: 14, fontSize: 13, background: 'var(--surface-2)' }}>{agreement?.body || 'Loading…'}</div>
            <div className="form-grid">
              <label className="field">Authorised representative *<input className="input" value={sig.signerName} onChange={(e) => setSig({ ...sig, signerName: e.target.value })} /></label>
              <label className="field">Title / position<input className="input" value={sig.signerTitle} onChange={(e) => setSig({ ...sig, signerTitle: e.target.value })} /></label>
            </div>
            <SignaturePad onChange={(d) => setSig((s) => ({ ...s, dataUrl: d }))} />
            <label className="check"><input type="checkbox" checked={sig.accepted} onChange={(e) => setSig({ ...sig, accepted: e.target.checked })} /> I have authority to bind this restaurant and accept the agreement, the <Link className="link" href="/terms" target="_blank">Terms</Link> and the <Link className="link" href="/privacy" target="_blank">Privacy Policy</Link>.</label>
            <p className="tiny muted" style={{ margin: 0 }}>We record your name, signature, time, IP address and a cryptographic hash of the agreement. Electronic signatures are recognised in many, but not all, jurisdictions.</p>
            {err && <div className="error-text" role="alert">{err}</div>}
            <div className="row-between"><button className="btn" onClick={() => setStep(2)}>Back</button><button className="btn btn-primary" disabled={!s3 || busy} onClick={submit}>{busy ? 'Submitting…' : 'Sign & register'}</button></div>
          </div>}
        </div>
      </div>
    </main>
  );
}
