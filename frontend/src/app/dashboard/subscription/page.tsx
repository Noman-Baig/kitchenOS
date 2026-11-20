'use client';
import { useState } from 'react';
import { api, download } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { dateOnly, money } from '@/lib/format';
import { useSession } from '@/components/Session';
import { ConfirmButton, PageHead, Skeleton, Status, useAction } from '@/components/ui';

export default function Subscription() {
  const s = useSession();
  const { data, reload } = useApi<any>('/r/subscription');
  const ag = useApi<any>('/r/agreements');
  const [planId, setPlanId] = useState('');
  const [method, setMethod] = useState('');
  const [ref, setRef] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [run, busy] = useAction();
  const d = data?.data;
  if (!d) return <div className="page"><Skeleton rows={8} /></div>;
  const a = d.availability;
  const pending = d.payments.find((p: any) => p.status === 'pending');
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <PageHead title="Subscription" subtitle={s.restaurant?.name} />
      <div className="grid grid-3 mb">
        <div className="card stat"><div className="label">Status</div><div className="value"><Status value={a.state} /></div></div>
        <div className="card stat"><div className="label">Expires</div><div className="value" style={{ fontSize: '1.1rem' }}>{a.expiresAt ? dateOnly(a.expiresAt) : '—'}</div><div className="small muted">Grace period: {d.graceDays} days</div></div>
        <div className="card stat"><div className="label">Plan</div><div className="value" style={{ fontSize: '1.1rem' }}>{d.plans.find((p: any) => p.id === d.planId)?.name || 'Not selected'}</div></div>
      </div>
      {a.state === 'pending' && <div className="alert alert-warning mb">Your registration is awaiting approval. You can submit your first subscription payment now so activation is quicker.</div>}
      {a.deletionScheduledAt && <div className="alert alert-danger mb">Your restaurant data is scheduled for deletion on {dateOnly(a.deletionScheduledAt)} if the account is not reactivated. Renew below or export your data.</div>}
      <div className="card stack mb">
        <h3>Pay / renew</h3>
        <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{d.instructions}</p>
        {d.bankAccounts.length > 0 && <div className="grid grid-2">{d.bankAccounts.map((b: any, i: number) => <div key={i} className="alert small"><strong>{b.bankName}</strong><div>{b.accountTitle}</div><div className="mono">{b.accountNumber}</div>{b.iban && <div className="mono">IBAN {b.iban}</div>}{b.instructions && <div className="muted">{b.instructions}</div>}</div>)}</div>}
        {pending ? <div className="alert">A payment of {money(pending.amount, pending.currency)} submitted on {dateOnly(pending.created_at)} is awaiting review.</div> : s.can('subscription.manage') && <div className="form-grid">
          <label className="field">Plan<select className="input" value={planId} onChange={(e) => setPlanId(e.target.value)}><option value="">Choose…</option>{d.plans.map((p: any) => <option key={p.id} value={p.id}>{p.name} — {money(p.price, p.currency)} / {p.duration_days} days</option>)}</select></label>
          <label className="field">Payment method<select className="input" value={method} onChange={(e) => setMethod(e.target.value)}><option value="">Choose…</option>{d.paymentMethods.map((m: string) => <option key={m}>{m}</option>)}</select></label>
          <label className="field">Transaction reference<input className="input" value={ref} onChange={(e) => setRef(e.target.value)} /></label>
          <label className="field">Payment screenshot<input className="input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] || null)} style={{ paddingTop: 6 }} /></label>
          <div className="full"><button className="btn btn-primary" disabled={busy || !planId || !method || !file} onClick={async () => { const fd = new FormData(); fd.append('planId', planId); fd.append('method', method); if (ref) fd.append('reference', ref); fd.append('proof', file!); const r = await run(() => api('/r/subscription/payments', { form: fd }), 'Payment submitted for review'); if (r) reload(); }}>Submit payment</button></div>
        </div>}
      </div>
      <div className="card mb"><h3>Payment history</h3>
        {d.payments.length === 0 ? <div className="small muted">No payments yet</div> : <div className="table-wrap"><table className="table"><thead><tr><th>Submitted</th><th>Plan</th><th className="num">Amount</th><th>Method</th><th>Status</th><th>Period</th></tr></thead><tbody>{d.payments.map((p: any) => <tr key={p.id}><td>{dateOnly(p.created_at)}</td><td>{p.plan_name}</td><td className="num">{money(p.amount, p.currency)}</td><td>{p.method}{p.reference ? ` · ${p.reference}` : ''}</td><td><Status value={p.status} />{p.rejection_reason ? <div className="tiny muted">{p.rejection_reason}</div> : null}</td><td className="small">{p.period_start ? `${dateOnly(p.period_start)} – ${dateOnly(p.period_end)}` : '—'}</td></tr>)}</tbody></table></div>}
      </div>
      <div className="card mb"><h3>Signed agreements</h3>
        {(ag.data?.data.history || []).map((h: any) => <div key={h.id} className="row-between small" style={{ padding: '6px 0' }}><span>{h.title} v{h.version} — signed by {h.signer_name} on {dateOnly(h.signed_at)} <span className="mono tiny muted">{h.content_hash.slice(0, 16)}…</span></span>{h.pdfUrl && <a className="btn btn-sm" href={h.pdfUrl} target="_blank" rel="noreferrer">PDF</a>}</div>)}
      </div>
      {s.can('subscription.manage') && <div className="card"><h3>Your data</h3><p className="small muted">Download a complete export of your restaurant’s data (JSON, gzip). Passwords and secrets are excluded.</p>
        <ConfirmButton danger={false} label="Export all data" confirm="Generate a full data export now? This can take a moment for large restaurants." onConfirm={async () => { const r = await run(() => api('/r/export', { body: {} })); if (r) await download(r.data.downloadUrl.replace('/api/v1', ''), `export-${s.restaurant?.slug}.json.gz`); }} className="btn" /></div>}
    </div>
  );
}
