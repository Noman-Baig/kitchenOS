'use client';
import { use, useState } from 'react';
import { api, download } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { dateOnly, dt, money, titleCase } from '@/lib/format';
import { ConfirmButton, PageHead, Skeleton, Status, Tabs, useAction } from '@/components/ui';

export default function AdminRestaurant({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, reload } = useApi<any>(`/platform/restaurants/${id}`);
  const plans = useApi<any>('/platform/plans');
  const [tab, setTab] = useState<'overview' | 'subscription' | 'staff' | 'orders' | 'agreements' | 'audit'>('overview');
  const orders = useApi<any>(tab === 'orders' ? `/platform/restaurants/${id}/orders?pageSize=100` : null);
  const audit = useApi<any>(tab === 'audit' ? `/platform/audit-logs?restaurantId=${id}&pageSize=100` : null);
  const [run, busy] = useAction();
  const [grace, setGrace] = useState('');
  const [expiry, setExpiry] = useState('');
  const [resetLink, setResetLink] = useState<{ name: string; link: string; emailed: boolean } | null>(null);
  const r = data?.data;
  if (!r) return <div className="page"><Skeleton rows={8} /></div>;
  const act = async (a: string, reason?: string) => { await run(() => api(`/platform/restaurants/${id}/${a}`, { body: { reason } }), `${titleCase(a)}d`); reload(); };
  return (
    <div className="page">
      <PageHead title={r.name} subtitle={`${r.slug} · ${r.city || ''} ${r.country} · ${r.currency} · ${r.timezone}`} actions={<>
        <Status value={r.availability.state} />
        {r.status === 'pending' && <><ConfirmButton label="Reject" confirm="Reject this registration?" reason="Reason (sent to the restaurant)" onConfirm={(x) => act('reject', x)} className="btn" /><button className="btn btn-primary" disabled={busy} onClick={() => act('approve')}>Approve</button></>}
        {['active'].includes(r.status) && <ConfirmButton label="Suspend" confirm="Suspend this restaurant? Staff are signed out, QR and online ordering stop, and deletion is scheduled after the retention period." reason="Reason (shown on the suspension page)" onConfirm={(x) => act('suspend', x)} className="btn" />}
        {['suspended', 'expired'].includes(r.status) && <button className="btn btn-primary" disabled={busy} onClick={() => act('reactivate')}>Reactivate</button>}
        <button className="btn" onClick={async () => { const x = await run(() => api(`/platform/restaurants/${id}/export`, { body: {} }), 'Export created'); if (x) await download(x.data.downloadUrl.replace('/api/v1', ''), `restaurant-${r.slug}.json.gz`); }}>Export data</button>
      </>} />
      {r.deletion_scheduled_at && <div className="alert alert-danger mb row-between">Data deletion scheduled for {dateOnly(r.deletion_scheduled_at)} {r.deletion_approved ? '(approved)' : '(awaiting your approval unless auto-delete is enabled)'}.
        <div className="row">{!r.deletion_approved && ['suspended', 'expired', 'rejected'].includes(r.status) && <ConfirmButton label="Approve deletion" confirm="Permanently delete this restaurant's data on the scheduled date? A final export is taken first." onConfirm={async () => { await run(() => api(`/platform/restaurants/${id}/deletion`, { body: { action: 'approve' } }), 'Deletion approved'); reload(); }} className="btn btn-sm" />}
          <button className="btn btn-sm" onClick={async () => { await run(() => api(`/platform/restaurants/${id}/deletion`, { body: { action: 'cancel' } }), 'Deletion cancelled'); reload(); }}>Cancel deletion</button></div></div>}
      <Tabs value={tab} onChange={setTab} items={[{ value: 'overview', label: 'Overview' }, { value: 'subscription', label: 'Subscription' }, { value: 'staff', label: 'Staff & branches' }, { value: 'orders', label: 'Orders' }, { value: 'agreements', label: 'Agreements' }, { value: 'audit', label: 'Audit' }]} />
      {tab === 'overview' && <div className="grid grid-3">
        <div className="card"><h3>Contact</h3><div className="small">{r.contact_email}<br />{r.contact_phone}<br />{r.address}</div></div>
        <div className="card"><h3>Activity</h3><div className="small">Closed bills: {r.stats.orders}<br />Lifetime billed: {money(r.stats.revenue, r.currency)}<br />Registered {dt(r.created_at)}<br />Approved {dt(r.approved_at)}</div></div>
        <div className="card"><h3>Status</h3><div className="small">State: {r.availability.state}<br />{r.status_reason && <>Reason: {r.status_reason}<br /></>}Expires: {dateOnly(r.subscription_expires_at)}<br />Grace ends: {dateOnly(r.availability.graceEndsAt)}</div></div>
      </div>}
      {tab === 'subscription' && <div className="stack">
        <div className="card form-grid">
          <label className="field">Plan<select className="input" value={r.plan_id || ''} onChange={async (e) => { await run(() => api(`/platform/restaurants/${id}`, { method: 'PATCH', body: { planId: e.target.value ? Number(e.target.value) : null } }), 'Plan updated'); reload(); }}><option value="">—</option>{(plans.data?.data || []).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="field">Grace days (blank = platform default)<div className="row"><input className="input grow" type="number" min={0} value={grace} placeholder={String(r.grace_days ?? 'default')} onChange={(e) => setGrace(e.target.value)} /><button className="btn" onClick={async () => { await run(() => api(`/platform/restaurants/${id}`, { method: 'PATCH', body: { graceDays: grace === '' ? null : Number(grace) } }), 'Saved'); reload(); }}>Save</button></div></label>
          <label className="field">Set expiry manually<div className="row"><input className="input grow" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /><button className="btn" disabled={!expiry} onClick={async () => { await run(() => api(`/platform/restaurants/${id}`, { method: 'PATCH', body: { subscriptionExpiresAt: new Date(`${expiry}T23:59:59Z`).toISOString() } }), 'Expiry updated'); reload(); }}>Save</button></div></label>
        </div>
        <div className="table-wrap"><table className="table"><thead><tr><th>Submitted</th><th>Plan</th><th className="num">Amount</th><th>Method</th><th>Status</th><th>Period</th><th>Proof</th></tr></thead><tbody>{r.payments.map((p: any) => <tr key={p.id}><td>{dateOnly(p.created_at)}</td><td>{p.plan_name}</td><td className="num">{money(p.amount, p.currency)}</td><td>{p.method}{p.reference ? ` · ${p.reference}` : ''}</td><td><Status value={p.status} /></td><td className="small">{p.period_start ? `${dateOnly(p.period_start)} – ${dateOnly(p.period_end)}` : '—'}</td><td>{p.proofUrl && <a className="btn btn-sm" href={p.proofUrl} target="_blank" rel="noreferrer">View</a>}</td></tr>)}</tbody></table></div>
      </div>}
      {tab === 'staff' && <div className="grid grid-2">
        <div className="card"><h3>Staff & managers</h3>{r.staff.map((u: any) => <div key={u.id} className="row-between small" style={{ padding: '4px 0' }}><span>{u.name} · {u.email}</span><span className="row" style={{ gap: 6 }}>{u.role} <Status value={u.active ? 'active' : 'suspended'} /><button className="btn btn-sm" disabled={busy} title="Create a one-time password reset link" onClick={async () => { const x = await run(() => api(`/platform/restaurants/${id}/users/${u.id}/reset-link`, { body: {} })); if (x) setResetLink({ name: u.name, link: x.link, emailed: x.emailed }); }}>Reset password</button></span></div>)}
          {resetLink && <div className="alert mt stack" style={{ gap: 6 }}><strong>Reset link for {resetLink.name}</strong><span className="small">{resetLink.emailed ? 'Emailed to the user. ' : 'Email is not configured — send this link to the user through a trusted channel. '}Valid for 24 hours, single use.</span><input className="input" readOnly value={resetLink.link} onFocus={(e) => e.currentTarget.select()} /><button className="btn btn-sm" onClick={() => navigator.clipboard?.writeText(resetLink.link)}>Copy link</button></div>}</div>
        <div className="card"><h3>Branches</h3>{r.branches.map((b: any) => <div key={b.id} className="small" style={{ padding: '4px 0' }}>{b.name}{b.is_main ? ' (main)' : ''} · {b.address || ''}</div>)}</div>
      </div>}
      {tab === 'orders' && <div><p className="small muted">Viewing restaurant orders is recorded in the audit log.</p>{orders.data && <div className="table-wrap"><table className="table"><thead><tr><th>Order</th><th>Channel</th><th>Status</th><th>Customer</th><th className="num">Subtotal</th><th>Created</th></tr></thead><tbody>{orders.data.data.map((o: any) => <tr key={o.id}><td>{o.order_no}</td><td>{o.channel} · {o.order_type}</td><td><Status value={o.status} /></td><td>{o.customer_name}</td><td className="num">{money(o.subtotal, r.currency)}</td><td className="small">{dt(o.created_at)}</td></tr>)}</tbody></table></div>}</div>}
      {tab === 'agreements' && <div className="card">{r.agreements.map((a: any) => <div key={a.id} className="row-between small" style={{ padding: '6px 0' }}><span>v{a.version} · {a.signer_name} ({a.signer_email}) · {dt(a.signed_at)} · <span className="mono tiny">{a.content_hash.slice(0, 20)}…</span>{a.signed_by_platform ? ' · platform-signed' : ''}</span>{a.pdfUrl && <a className="btn btn-sm" href={a.pdfUrl} target="_blank" rel="noreferrer">PDF</a>}</div>)}</div>}
      {tab === 'audit' && audit.data && <div className="table-wrap"><table className="table"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th></tr></thead><tbody>{audit.data.data.map((a: any) => <tr key={a.id}><td className="small">{dt(a.created_at)}</td><td className="small">{a.user_email || a.actor_type}</td><td className="mono small">{a.action}</td><td className="small">{a.entity} #{a.entity_id}</td></tr>)}</tbody></table></div>}
    </div>
  );
}
