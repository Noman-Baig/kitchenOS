'use client';
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { titleCase } from '@/lib/format';
import { PageHead, Skeleton, Tabs, useAction } from '@/components/ui';

export default function AdminSettings() {
  const { data, reload } = useApi<any>('/platform/settings');
  const [tab, setTab] = useState<'branding' | 'subscription' | 'automations' | 'system'>('branding');
  const [b, setB] = useState<any>(null); const [sub, setSub] = useState<any>(null); const [auto, setAuto] = useState<any>(null);
  const [run, busy] = useAction();
  useEffect(() => { if (data) { setB(data.data.branding); setSub(data.data.subscription); setAuto(data.data.automations); } }, [data]);
  if (!b) return <div className="page"><Skeleton rows={8} /></div>;
  const upload = async (kind: 'logo' | 'favicon', file: File) => { const fd = new FormData(); fd.append('file', file); await run(() => api(`/platform/settings/branding/${kind}`, { form: fd }), `${titleCase(kind)} updated`); reload(); };
  const txt = (k: string, label: string, full = false) => <label className={`field ${full ? 'full' : ''}`}>{label}<input className="input" value={b[k] || ''} onChange={(e) => setB({ ...b, [k]: e.target.value })} /></label>;
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <PageHead title="Branding & settings" />
      <Tabs value={tab} onChange={setTab} items={[{ value: 'branding', label: 'Branding' }, { value: 'subscription', label: 'Subscriptions & retention' }, { value: 'automations', label: 'Automations' }, { value: 'system', label: 'System status' }]} />
      {tab === 'branding' && <div className="card">
        <p className="small muted">Applies everywhere: website, login, dashboards, customer pages, receipts, invoices, PDF and Excel reports, emails and browser metadata (cached up to 60 seconds).</p>
        <div className="form-grid">
          {txt('softwareName', 'Software name')}
          <div className="field">Logo / favicon<div className="row">{b.logoUrl && <img src={b.logoUrl} alt="" width={32} height={32} />}<label className="btn btn-sm" style={{ cursor: 'pointer' }}>Logo<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && upload('logo', e.target.files[0])} /></label>{b.faviconUrl && <img src={b.faviconUrl} alt="" width={20} height={20} />}<label className="btn btn-sm" style={{ cursor: 'pointer' }}>Favicon<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && upload('favicon', e.target.files[0])} /></label></div></div>
          <label className="field">Primary colour<input className="input" type="color" value={b.primaryColor} onChange={(e) => setB({ ...b, primaryColor: e.target.value.toUpperCase() })} style={{ padding: 2 }} /></label>
          <label className="field">Secondary colour<input className="input" type="color" value={b.secondaryColor} onChange={(e) => setB({ ...b, secondaryColor: e.target.value.toUpperCase() })} style={{ padding: 2 }} /></label>
          {txt('supportEmail', 'Support email')}{txt('supportPhone', 'Support phone')}{txt('businessAddress', 'Business address', true)}{txt('websiteUrl', 'Website URL')}{txt('copyright', 'Copyright line')}{txt('footerText', 'Footer text', true)}{txt('termsUrl', 'Terms URL')}{txt('privacyUrl', 'Privacy URL')}{txt('emailSenderName', 'Email sender name')}{txt('emailSenderAddress', 'Email sender address')}
        </div>
        <button className="btn btn-primary mt" disabled={busy} onClick={async () => { const { logoUrl, faviconUrl, ...rest } = b; void logoUrl; void faviconUrl; await run(() => api('/platform/settings/branding', { method: 'PUT', body: rest }), 'Branding saved'); reload(); }}>Save branding</button>
      </div>}
      {tab === 'subscription' && sub && <div className="card stack">
        <div className="form-grid">
          <label className="field">Default grace period (days)<input className="input" type="number" min={0} value={sub.defaultGraceDays} onChange={(e) => setSub({ ...sub, defaultGraceDays: Number(e.target.value) })} /></label>
          <label className="field">Trial days on approval<input className="input" type="number" min={0} value={sub.trialDays} onChange={(e) => setSub({ ...sub, trialDays: Number(e.target.value) })} /></label>
          <label className="field">Expiry reminders (days before, comma separated)<input className="input" value={sub.reminderDaysBefore.join(', ')} onChange={(e) => setSub({ ...sub, reminderDaysBefore: e.target.value.split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x >= 0) })} /></label>
          <label className="field">Data retention after suspension/expiry (days)<input className="input" type="number" min={1} value={sub.dataRetentionDays} onChange={(e) => setSub({ ...sub, dataRetentionDays: Number(e.target.value) })} /></label>
          <label className="check full"><input type="checkbox" checked={sub.autoDeleteAfterRetention} onChange={(e) => setSub({ ...sub, autoDeleteAfterRetention: e.target.checked })} /> Delete automatically when retention ends (otherwise each deletion needs your approval). A final export is always taken first.</label>
          <label className="field full">Payment methods offered (comma separated)<input className="input" value={sub.paymentMethods.join(', ')} onChange={(e) => setSub({ ...sub, paymentMethods: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></label>
          <label className="field full">Payment instructions<textarea className="input" value={sub.paymentInstructions} onChange={(e) => setSub({ ...sub, paymentInstructions: e.target.value })} /></label>
        </div>
        <div className="section-title">Bank accounts shown to restaurants</div>
        {sub.bankAccounts.map((a: any, i: number) => <div key={i} className="row">{['bankName', 'accountTitle', 'accountNumber', 'iban', 'currency'].map((k) => <input key={k} className="input grow" placeholder={titleCase(k.replace(/([A-Z])/g, ' $1'))} value={a[k] || ''} onChange={(e) => setSub({ ...sub, bankAccounts: sub.bankAccounts.map((x: any, j: number) => j === i ? { ...x, [k]: e.target.value } : x) })} />)}<button className="btn btn-ghost icon-btn" aria-label="Remove" onClick={() => setSub({ ...sub, bankAccounts: sub.bankAccounts.filter((_: any, j: number) => j !== i) })}><Trash2 size={15} /></button></div>)}
        <div><button className="btn" onClick={() => setSub({ ...sub, bankAccounts: [...sub.bankAccounts, { bankName: '', accountTitle: '', accountNumber: '' }] })}>+ Add bank account</button></div>
        <div><button className="btn btn-primary" disabled={busy} onClick={async () => { await run(() => api('/platform/settings/subscription', { method: 'PUT', body: sub }), 'Saved'); reload(); }}>Save</button></div>
      </div>}
      {tab === 'automations' && auto && <div className="card stack">
        <p className="small muted">Automations run in the background worker, are protected against duplicate execution and are recorded in Backups & operations → Jobs.</p>
        {Object.keys(auto).map((k) => <label key={k} className="check"><input type="checkbox" checked={!!auto[k]} onChange={(e) => setAuto({ ...auto, [k]: e.target.checked })} />{titleCase(k.replace(/([A-Z])/g, ' $1'))}</label>)}
        <div><button className="btn btn-primary" disabled={busy} onClick={async () => { await run(() => api('/platform/settings/automations', { method: 'PUT', body: auto }), 'Saved'); reload(); }}>Save</button></div>
      </div>}
      {tab === 'system' && <div className="card stack small">
        <div>SMTP email: <strong>{data.data.smtpConfigured ? 'configured' : 'not configured (in-app notifications still work)'}</strong></div>
        <div>Redis (multi-instance realtime): <strong>{data.data.redisConfigured ? 'configured' : 'not configured (single instance mode)'}</strong></div>
        <div>TURN relay for voice calls: <strong>{data.data.turnConfigured ? 'configured' : 'not configured (calls rely on STUN; some networks will fail — see deployment guide)'}</strong></div>
      </div>}
    </div>
  );
}
