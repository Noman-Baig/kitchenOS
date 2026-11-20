'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { dt, money } from '@/lib/format';
import { ConfirmButton, Empty, PageHead, Status, useAction } from '@/components/ui';

export default function AdminPayments() {
  const [status, setStatus] = useState('pending');
  const { data, reload } = useApi<any>(`/platform/subscription-payments?pageSize=100${status ? `&status=${status}` : ''}`);
  const [run, busy] = useAction();
  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <PageHead title="Subscription payments" subtitle="Verify each transfer in your bank before approving. Approval extends the subscription by the plan duration." actions={<div className="segmented">{[['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['', 'All']].map(([v, l]) => <button key={v} className={status === v ? 'active' : ''} onClick={() => setStatus(v)}>{l}</button>)}</div>} />
      {!data ? <div className="skeleton" /> : data.data.length === 0 ? <Empty title="Nothing here" /> : <div className="stack">{data.data.map((p: any) => (
        <div key={p.id} className="card row" style={{ alignItems: 'flex-start' }}>
          {p.proofUrl ? <a href={p.proofUrl} target="_blank" rel="noreferrer"><img src={p.proofUrl} alt="Payment proof" style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} /></a> : null}
          <div className="grow stack" style={{ gap: 4 }}>
            <div className="row"><strong style={{ fontSize: 17 }}>{money(p.amount, p.currency)}</strong><Status value={p.status} /><span className="small muted">{dt(p.created_at)}</span></div>
            <div><Link className="link" href={`/admin/restaurants/${p.restaurant_id}`}>{p.restaurant_name}</Link> · {p.plan_name} · {p.method}{p.reference ? ` · ref ${p.reference}` : ''}</div>
            {p.rejection_reason && <div className="small muted">Rejected: {p.rejection_reason}</div>}
            {p.period_end && <div className="small muted">Period {dt(p.period_start, undefined, { dateStyle: 'medium' })} – {dt(p.period_end, undefined, { dateStyle: 'medium' })}</div>}
            {p.status === 'pending' && <div className="row mt-s"><button className="btn btn-primary" disabled={busy} onClick={async () => { await run(() => api(`/platform/subscription-payments/${p.id}/approve`, { body: {} }), 'Approved — subscription extended'); reload(); }}>Approve</button>
              <ConfirmButton label="Reject" confirm="Reject this payment?" reason="Reason (sent to the restaurant)" onConfirm={async (r) => { await run(() => api(`/platform/subscription-payments/${p.id}/reject`, { body: { reason: r } }), 'Rejected'); reload(); }} className="btn" /></div>}
          </div>
        </div>))}</div>}
    </div>
  );
}
