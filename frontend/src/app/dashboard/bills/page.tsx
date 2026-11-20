'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useApi, useDebounced } from '@/lib/hooks';
import { useStaffEvents } from '@/lib/socket';
import { dt, money, titleCase } from '@/lib/format';
import { useSession } from '@/components/Session';
import { Empty, PageHead, Status } from '@/components/ui';

export default function Bills() {
  const s = useSession();
  const [status, setStatus] = useState('open');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const { data, reload } = useApi<any>(`/r/bills?pageSize=100${status ? `&status=${status}` : ''}${q ? `&search=${encodeURIComponent(q)}` : ''}`);
  useStaffEvents({ 'bill:updated': reload, 'order:new': reload }, reload);
  return (
    <div className="page">
      <PageHead title="Bills" subtitle="Open tabs, settled bills, refunds and receipts." actions={<>
        <input className="input" style={{ width: 220 }} placeholder="Bill no. or customer" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search bills" />
        <div className="segmented">{[['open', 'Open'], ['closed', 'Closed'], ['void', 'Void'], ['', 'All']].map(([v, l]) => <button key={v} className={status === v ? 'active' : ''} onClick={() => setStatus(v)}>{l}</button>)}</div>
      </>} />
      {!data ? <div className="skeleton" /> : data.data.length === 0 ? <Empty title="No bills" /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Bill</th><th>Status</th><th>Payment</th><th>Channel</th><th>Table / customer</th><th className="num">Total</th><th className="num">Paid</th><th>Opened</th></tr></thead>
          <tbody>{data.data.map((b: any) => <tr key={b.id} className="clickable" onClick={() => (location.href = `/dashboard/bills/${b.id}`)}><td><Link href={`/dashboard/bills/${b.id}`}><strong>{b.bill_no}</strong></Link></td><td><Status value={b.status} /></td><td><Status value={b.payment_status} /></td><td>{titleCase(b.channel)}</td><td>{b.table_name || titleCase(b.order_type)} · {b.customer_name || 'Guest'}</td><td className="num">{money(b.total, s.currency)}</td><td className="num">{money(b.paid_total, s.currency)}</td><td className="small">{dt(b.opened_at, s.tz)}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}
