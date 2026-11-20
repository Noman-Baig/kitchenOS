'use client';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useApi, useNow } from '@/lib/hooks';
import { beep, useStaffEvents } from '@/lib/socket';
import { ago, money, titleCase } from '@/lib/format';
import { useSession } from '@/components/Session';
import { ConfirmButton, Empty, PageHead, Status, useAction } from '@/components/ui';

export default function PendingPayments() {
  const s = useSession();
  const now = useNow(20000);
  const { data, reload } = useApi<any>('/r/payments/pending');
  const [run, busy] = useAction();
  useStaffEvents({ 'bill:updated': reload, notification: (n) => { if (['payment_submitted', 'cash_requested'].includes(n.type)) { beep(); reload(); } } }, reload);
  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <PageHead title="Payment approvals" subtitle="Screenshots are never treated as paid until you approve them. Check the amount and reference in your bank or wallet first." />
      {!data ? <div className="skeleton" /> : data.data.length === 0 ? <Empty title="Nothing to review" /> : (
        <div className="stack">{data.data.map((p: any) => (
          <div key={p.id} className="card row" style={{ alignItems: 'flex-start' }}>
            {p.proofUrl ? <a href={p.proofUrl} target="_blank" rel="noreferrer"><img src={p.proofUrl} alt="Payment proof" style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} /></a> : <div style={{ width: 120, height: 120, borderRadius: 8, background: 'var(--surface-2)', display: 'grid', placeItems: 'center' }} className="small muted">{p.status === 'cash_requested' ? 'Cash' : 'No proof'}</div>}
            <div className="grow stack" style={{ gap: 4 }}>
              <div className="row"><strong style={{ fontSize: 18 }}>{money(p.amount, s.currency)}</strong><Status value={p.status} /><span className="tiny muted">{ago(p.created_at, now)} ago</span></div>
              <div className="small">{p.method_label || titleCase(p.method_type)}{p.reference ? ` · ref ${p.reference}` : ''}</div>
              <div className="small muted"><Link className="link" href={`/dashboard/bills/${p.bill_id}`}>Bill {p.bill_no}</Link> · {p.table_name || 'Online'} · {p.customer_name || 'Guest'} · bill total {money(p.bill_total, s.currency)}, paid {money(p.paid_total, s.currency)}</div>
              <div className="row mt-s">
                <button className="btn btn-primary" disabled={busy} onClick={async () => { await run(() => api(`/r/payments/${p.id}/approve`, { body: {} }), p.status === 'cash_requested' ? 'Cash collected' : 'Approved'); reload(); }}>{p.status === 'cash_requested' ? 'Mark cash collected' : 'Approve'}</button>
                <ConfirmButton label="Reject" confirm="Reject this payment?" reason="Reason (shown to the customer)" onConfirm={async (r) => { await run(() => api(`/r/payments/${p.id}/reject`, { body: { reason: r } }), 'Rejected'); reload(); }} className="btn" />
              </div>
            </div>
          </div>
        ))}</div>
      )}
    </div>
  );
}
