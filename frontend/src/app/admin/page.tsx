'use client';
import Link from 'next/link';
import { useApi } from '@/lib/hooks';
import { dateOnly, money } from '@/lib/format';
import { PageHead, Skeleton, Stat, Status } from '@/components/ui';

export default function AdminOverview() {
  const { data } = useApi<any>('/platform/overview');
  const d = data?.data;
  return (
    <div className="page">
      <PageHead title="Platform overview" />
      {!d ? <Skeleton rows={8} /> : <div className="stack" style={{ gap: 16 }}>
        <div className="grid grid-4">
          <Stat label="Active (paid)" value={d.subscriptions.active} sub={`${d.subscriptions.grace} in grace period`} />
          <Stat label="Pending approval" value={d.byStatus.pending || 0} sub={<Link className="link" href="/admin/restaurants?status=pending">Review</Link>} />
          <Stat label="Suspended / expired" value={(d.byStatus.suspended || 0) + (d.byStatus.expired || 0)} />
          <Stat label="Payments to review" value={d.pendingPayments} sub={<Link className="link" href="/admin/payments">Review</Link>} />
        </div>
        <div className="grid grid-2">
          <div className="card"><h3>Monthly recurring revenue</h3>{d.mrr.length === 0 ? <div className="small muted">No active paid subscriptions</div> : d.mrr.map((m: any) => <div key={m.currency} className="row-between"><span>{m.currency} · {m.n} restaurants</span><strong>{money(m.mrr, m.currency)}</strong></div>)}<p className="tiny muted mt-s">Normalised to 30 days per plan duration. Currencies are not converted.</p></div>
          <div className="card"><h3>Recent registrations</h3>{d.recentRegistrations.map((r: any) => <div key={r.id} className="row-between small" style={{ padding: '4px 0' }}><Link className="link" href={`/admin/restaurants/${r.id}`}>{r.name}</Link><span>{r.country} · {dateOnly(r.created_at)} <Status value={r.status} /></span></div>)}{d.newDemoRequests > 0 && <div className="small mt-s"><Link className="link" href="/admin/operations">{d.newDemoRequests} new demo request(s)</Link></div>}</div>
        </div>
      </div>}
    </div>
  );
}
