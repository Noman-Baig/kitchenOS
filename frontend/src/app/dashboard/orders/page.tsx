'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useNow } from '@/lib/hooks';
import { beep, useStaffEvents } from '@/lib/socket';
import { ago, dt, money, titleCase } from '@/lib/format';
import { useSession } from '@/components/Session';
import { Empty, PageHead, Status, useAction } from '@/components/ui';
import { OrderDrawer } from '@/components/OrderDrawer';

const COLS = [['pending_approval', 'Needs approval'], ['accepted', 'Accepted'], ['preparing', 'Preparing'], ['ready', 'Ready']] as const;

export default function Orders() {
  const s = useSession();
  const [view, setView] = useState<'board' | 'list'>('board');
  const [sel, setSel] = useState<number | null>(null);
  const now = useNow(15000);
  const board = useApi<any>('/r/orders?active=1&withItems=1&pageSize=200');
  const list = useApi<any>(view === 'list' ? '/r/orders?pageSize=100' : null);
  useStaffEvents({ 'order:new': () => { beep(); board.reload(); list.reload(); }, 'order:updated': () => { board.reload(); list.reload(); }, 'order:edited': () => board.reload() }, () => board.reload());
  const orders = board.data?.data || [];
  const [run] = useAction();
  return (
    <div className="page">
      <PageHead title="Orders" subtitle="Live orders from QR, online, waiters and POS" actions={<div className="segmented"><button className={view === 'board' ? 'active' : ''} onClick={() => setView('board')}>Live board</button><button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>All orders</button></div>} />
      {view === 'board' ? (
        <div className="board">
          {COLS.map(([st, label]) => {
            const col = orders.filter((o: any) => o.status === st);
            return (
              <div key={st} className="board-col"><h3>{label}<span className="badge">{col.length}</span></h3>
                {col.length === 0 && <div className="empty small">—</div>}
                {col.map((o: any) => (
                  <div key={o.id} className="ticket" role="button" tabIndex={0} onClick={() => setSel(o.id)} onKeyDown={(e) => e.key === 'Enter' && setSel(o.id)} style={{ cursor: 'pointer' }}>
                    <div className="row-between"><strong>{o.order_no}</strong><span className="tiny muted">{ago(o.created_at, now)}</span></div>
                    <div className="small muted">{o.table_name || titleCase(o.order_type)} · {o.customer_name || 'Guest'} · {titleCase(o.channel)}{o.is_addition ? ' · addition' : ''}</div>
                    <ul className="ticket-items">{(o.items || []).filter((i: any) => i.status !== 'cancelled').map((i: any) => <li key={i.id}><span className="qty">{i.quantity}×</span>{i.name}{i.variant_name ? ` (${i.variant_name})` : ''}</li>)}</ul>
                    {st === 'pending_approval' && s.can('orders.manage') && <button className="btn btn-sm btn-primary btn-block" onClick={async (e) => { e.stopPropagation(); await run(() => api(`/r/orders/${o.id}/status`, { body: { status: 'accepted' } }), 'Accepted'); board.reload(); }}>Accept</button>}
                    {st === 'ready' && <button className="btn btn-sm btn-primary btn-block" onClick={async (e) => { e.stopPropagation(); await run(() => api(`/r/orders/${o.id}/status`, { body: { status: 'served' } }), 'Served'); board.reload(); }}>Mark served</button>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        !list.data ? <div className="skeleton" /> : list.data.data.length === 0 ? <Empty title="No orders yet" /> :
          <div className="table-wrap"><table className="table"><thead><tr><th>Order</th><th>Status</th><th>Channel</th><th>Table / customer</th><th className="num">Subtotal</th><th>Created</th></tr></thead>
            <tbody>{list.data.data.map((o: any) => <tr key={o.id} className="clickable" onClick={() => setSel(o.id)}><td><strong>{o.order_no}</strong>{o.is_addition ? <span className="badge" style={{ marginLeft: 6 }}>addition</span> : null}</td><td><Status value={o.status} /></td><td>{titleCase(o.channel)} · {titleCase(o.order_type)}</td><td>{o.table_name || '—'} · {o.customer_name || 'Guest'}</td><td className="num">{money(o.subtotal, s.currency)}</td><td className="small">{dt(o.created_at, s.tz)}</td></tr>)}</tbody></table></div>
      )}
      <OrderDrawer id={sel} onClose={() => setSel(null)} onChanged={() => { board.reload(); list.reload(); }} />
    </div>
  );
}
