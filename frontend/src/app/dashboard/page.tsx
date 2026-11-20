'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { useStaffEvents } from '@/lib/socket';
import { compact, money, titleCase, ago } from '@/lib/format';
import { useSession } from '@/components/Session';
import { DateFilter, ErrorState, PageHead, Skeleton, Stat, rangeQuery } from '@/components/ui';

function Bars({ series, currency }: { series: { d: string; total: string }[]; currency: string }) {
  if (!series.length) return <div className="empty small">No closed bills in this period</div>;
  const max = Math.max(...series.map((s) => Number(s.total)), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 160 }} role="img" aria-label="Revenue by day">
      {series.map((s) => (
        <div key={s.d} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }} title={`${s.d}: ${money(s.total, currency)}`}>
          <div style={{ width: '100%', maxWidth: 38, height: `${(Number(s.total) / max) * 130}px`, background: 'var(--brand)', borderRadius: '5px 5px 0 0', minHeight: 2 }} />
          <span className="tiny muted">{s.d.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Overview() {
  const s = useSession();
  const [range, setRange] = useState({ preset: 'today' });
  const [branch, setBranch] = useState('');
  const { data, error, loading, reload } = useApi<any>(`/r/dashboard?${rangeQuery(range)}${branch ? `&branchId=${branch}` : ''}`);
  useStaffEvents({ 'order:new': reload, 'order:updated': reload, 'bill:updated': reload }, reload);
  const d = data?.data; const cur = s.currency;
  return (
    <div className="page">
      <PageHead title={`Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening'}, ${s.user.name.split(' ')[0]}`} subtitle={s.restaurant?.name}
        actions={<>{s.branches.length > 1 && <select className="input" style={{ width: 170 }} value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch"><option value="">All branches</option>{s.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}<DateFilter value={range} onChange={setRange} /></>} />
      {error ? <ErrorState error={error} retry={reload} /> : loading || !d ? <Skeleton rows={8} /> : (
        <div className="stack" style={{ gap: 16 }}>
          <div className="grid grid-4">
            <Stat label="Sales (closed bills)" value={<span title={money(d.sales.total, cur)}>{compact(d.sales.total, cur)}</span>} sub={`${d.sales.bills} bills`} />
            <Stat label="Orders" value={d.orders.total} sub={`${d.orders.pending_approval || 0} pending · ${d.orders.preparing || 0} preparing · ${d.orders.ready || 0} ready`} />
            <Stat label="Tables" value={`${d.tables.active} / ${d.tables.total}`} sub={`${d.tables.available} available`} />
            <Stat label="Avg. preparation" value={d.avgPrepMinutes ? `${d.avgPrepMinutes} min` : '—'} sub="accepted → ready" />
          </div>
          <div className="grid grid-4">
            <Stat label="Pending payments" value={d.pendingPayments.count} sub={money(d.pendingPayments.amount, cur)} />
            <Stat label="Open requests" value={d.pendingRequests} sub={<Link className="link" href="/dashboard/support">View</Link>} />
            <Stat label="Expenses" value={compact(d.expenses, cur)} sub="incl. payroll, wastage, comps" />
            <Stat label="Estimated net profit" value={d.estimatedProfit !== null ? compact(d.estimatedProfit, cur) : '—'} sub="from the ledger" />
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)' }}>
            <div className="card"><h3>Revenue</h3><Bars series={d.revenueSeries} currency={cur} /></div>
            <div className="card"><h3>Order status</h3>
              <div className="stack" style={{ gap: 6 }}>{['pending_approval', 'accepted', 'preparing', 'ready', 'served', 'completed', 'cancelled', 'rejected'].map((st) => <div key={st} className="row-between small"><span>{titleCase(st)}</span><strong>{d.orders[st] || 0}</strong></div>)}</div>
            </div>
          </div>
          <div className="grid grid-3">
            <div className="card"><h3>Top items</h3>{d.topItems.length ? d.topItems.map((t: any) => <div key={t.menu_item_id} className="row-between small" style={{ padding: '4px 0' }}><span>{t.name}</span><span className="muted">{t.qty} · {money(t.revenue, cur)}</span></div>) : <div className="muted small">No sales yet</div>}</div>
            <div className="card"><h3>Low stock</h3>{d.lowStock.length ? d.lowStock.map((i: any) => <div key={i.id} className="row-between small" style={{ padding: '4px 0' }}><span>{i.name}</span><span className="badge badge-danger">{Number(i.stock_qty).toFixed(1)} / {Number(i.min_qty).toFixed(0)} {i.unit}</span></div>) : <div className="muted small">All stock above minimum</div>}</div>
            <div className="card"><h3>Recent activity</h3>{d.recentActivity.map((a: any, i: number) => <div key={i} className="small" style={{ padding: '4px 0' }}><span>{titleCase(a.action.replace('.', ' '))}</span> <span className="muted">· {a.user_name || 'system'} · {ago(a.created_at)} ago</span></div>)}</div>
          </div>
          {d.pnl && <div className="card"><h3>Profit snapshot</h3><div className="grid grid-4 small">
            {[['Net sales', d.pnl.netSales], ['Cost of goods', d.pnl.cogs], ['Gross profit', d.pnl.grossProfit], ['Taxes collected (liability)', d.pnl.taxesCollected]].map(([l, v]) => <div key={l}><div className="muted">{l}</div><strong>{money(v, cur)}</strong></div>)}
          </div></div>}
        </div>
      )}
    </div>
  );
}
