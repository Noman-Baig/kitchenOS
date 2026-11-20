'use client';
import { useState } from 'react';
import { FileDown, FileSpreadsheet } from 'lucide-react';
import { download } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { dt, money, num } from '@/lib/format';
import { useSession } from '@/components/Session';
import { useOptions } from '@/components/ResourcePage';
import { DateFilter, Empty, ErrorState, PageHead, Skeleton, rangeQuery } from '@/components/ui';

export default function Reports() {
  const s = useSession();
  const list = useApi<any>('/r/reports');
  const [key, setKey] = useState('sales');
  const [range, setRange] = useState<{ preset: string; from?: string; to?: string }>({ preset: 'this_month' });
  const [f, setF] = useState({ branchId: '', employeeId: '', paymentMethod: '', orderType: '', channel: '', categoryId: '', groupBy: 'day' });
  const cats = useOptions('/r/categories');
  const staff = useApi<any>('/r/staff');
  const qs = `${rangeQuery(range)}&${new URLSearchParams(Object.entries(f).filter(([, v]) => v) as any).toString()}`;
  const rep = useApi<any>(`/r/reports/${key}?${qs}`);
  const r = rep.data?.data;
  const fmt = (v: any, type?: string) => v === null || v === undefined || v === '' ? '—' : type === 'money' ? money(v, s.currency) : type === 'percent' ? `${Number(v).toFixed(2)}%` : type === 'number' ? num(v, 2) : type === 'date' ? dt(v, s.tz) : String(v);
  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <PageHead title="Reports" subtitle="All figures reconcile with the transaction ledger. Exports keep exact values." actions={<>
        <button className="btn" onClick={() => download(`/r/reports/${key}?${qs}&format=pdf`, `${key}.pdf`)}><FileDown size={15} /> PDF</button>
        <button className="btn" onClick={() => download(`/r/reports/${key}?${qs}&format=xlsx`, `${key}.xlsx`)}><FileSpreadsheet size={15} /> Excel</button></>} />
      <div className="grid" style={{ gridTemplateColumns: '230px minmax(0,1fr)' }}>
        <nav className="card" style={{ padding: 6, alignSelf: 'start' }} aria-label="Reports">
          {(list.data?.data || []).map((x: any) => <button key={x.key} disabled={!x.allowed} onClick={() => setKey(x.key)} className={`nav-link ${key === x.key ? 'active' : ''}`} style={{ width: '100%', border: 0, background: key === x.key ? undefined : 'transparent', cursor: x.allowed ? 'pointer' : 'not-allowed', font: 'inherit', opacity: x.allowed ? 1 : 0.45 }} title={x.allowed ? '' : 'Requires financial report access'}>{x.title}</button>)}
        </nav>
        <div className="stack">
          <div className="card card-tight row">
            <DateFilter value={range} onChange={setRange} />
            <select className="input" style={{ width: 120 }} value={f.groupBy} onChange={(e) => setF({ ...f, groupBy: e.target.value })} aria-label="Group by"><option value="day">Daily</option><option value="week">Weekly</option><option value="month">Monthly</option><option value="year">Yearly</option></select>
            {s.branches.length > 1 && <select className="input" style={{ width: 150 }} value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })} aria-label="Branch"><option value="">All branches</option>{s.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
            <select className="input" style={{ width: 150 }} value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })} aria-label="Employee"><option value="">All employees</option>{(staff.data?.data || []).map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
            <select className="input" style={{ width: 140 }} value={f.paymentMethod} onChange={(e) => setF({ ...f, paymentMethod: e.target.value })} aria-label="Payment method"><option value="">Any payment</option>{['cash', 'card', 'bank', 'wallet', 'other'].map((m) => <option key={m} value={m}>{m}</option>)}</select>
            <select className="input" style={{ width: 140 }} value={f.orderType} onChange={(e) => setF({ ...f, orderType: e.target.value })} aria-label="Order type"><option value="">Any type</option>{['dine_in', 'takeaway', 'pickup', 'delivery'].map((m) => <option key={m} value={m}>{m.replace('_', '-')}</option>)}</select>
            <select className="input" style={{ width: 130 }} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} aria-label="Channel"><option value="">Any channel</option>{['qr', 'online', 'pos', 'waiter'].map((m) => <option key={m} value={m}>{m}</option>)}</select>
            <select className="input" style={{ width: 150 }} value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })} aria-label="Category"><option value="">All categories</option>{cats.map((c: any) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>
          </div>
          {rep.error ? <ErrorState error={rep.error} retry={rep.reload} /> : !r ? <Skeleton rows={6} /> : <>
            <div className="row-between"><h2 style={{ margin: 0 }}>{r.title}</h2><span className="small muted">{r.range?.label} · {s.tz}</span></div>
            {r.summary?.length > 0 && <div className="grid grid-4">{r.summary.map((x: any) => <div key={x.label} className="card card-tight stat"><div className="label">{x.label}</div><div className="value" style={{ fontSize: '1.15rem' }}>{x.type === 'money' ? money(x.value, s.currency) : x.value}</div></div>)}</div>}
            {r.rows.length === 0 ? <div className="card"><Empty title="No data for this period" /></div> : <div className="table-wrap"><table className="table"><thead><tr>{r.columns.map((c: any) => <th key={c.key} className={['money', 'number', 'percent'].includes(c.type) ? 'num' : ''}>{c.label}</th>)}</tr></thead>
              <tbody>{r.rows.map((row: any, i: number) => <tr key={i}>{r.columns.map((c: any) => <td key={c.key} className={['money', 'number', 'percent'].includes(c.type) ? 'num' : ''}>{fmt(row[c.key], c.type)}</td>)}</tr>)}</tbody></table></div>}
            {r.notes?.map((n: string, i: number) => <p key={i} className="small muted" style={{ margin: 0 }}>{n}</p>)}
          </>}
        </div>
      </div>
    </div>
  );
}
