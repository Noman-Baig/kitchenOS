'use client';
import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { money, titleCase } from '@/lib/format';
import { PageHead, Skeleton, Stat } from '@/components/ui';

export default function AdminReports() {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), to: today, country: '', currency: '', status: '' });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as any).toString();
  const { data } = useApi<any>(`/platform/reports?${qs}`);
  const d = data?.data;
  return (
    <div className="page">
      <PageHead title="Platform reports" actions={<div className="row">
        <input className="input" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="From" />
        <input className="input" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="To" />
        <input className="input" style={{ width: 90 }} placeholder="Country" maxLength={2} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value.toUpperCase() })} />
        <input className="input" style={{ width: 90 }} placeholder="Currency" maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} />
        <select className="input" style={{ width: 130 }} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status"><option value="">Any status</option>{['active', 'pending', 'suspended', 'expired'].map((x) => <option key={x}>{x}</option>)}</select></div>} />
      {!d ? <Skeleton rows={8} /> : <div className="stack">
        <div className="grid grid-4">
          <Stat label="New registrations" value={d.registrations.reduce((a: number, r: any) => a + Number(r.n), 0)} />
          <Stat label="Renewals approved" value={d.renewals.reduce((a: number, r: any) => a + Number(r.n), 0)} />
          <Stat label="Orders on platform" value={d.usage.orders} sub={`${d.usage.sessions} guest sessions`} />
          <Stat label="Active branches" value={d.branchStats.branches} sub={`${d.usage.staff} staff accounts`} />
        </div>
        <div className="grid grid-2">
          <div className="card"><h3>Subscription payments</h3>{d.payments.map((p: any, i: number) => <div key={i} className="row-between small"><span>{titleCase(p.status)} · {p.currency} ({p.n})</span><strong>{money(p.amount, p.currency)}</strong></div>)}</div>
          <div className="card"><h3>By country</h3>{d.byCountry.map((c: any, i: number) => <div key={i} className="row-between small"><span>{c.country} · {c.status}</span><strong>{c.n}</strong></div>)}</div>
        </div>
        <div className="card"><h3>Restaurant activity</h3><div className="table-wrap"><table className="table"><thead><tr><th>Restaurant</th><th className="num">Closed bills</th><th className="num">Gross billed</th></tr></thead><tbody>{d.activity.map((a: any) => <tr key={a.id}><td>{a.name}</td><td className="num">{a.bills}</td><td className="num">{money(a.gmv, a.currency)}</td></tr>)}</tbody></table></div></div>
      </div>}
    </div>
  );
}
