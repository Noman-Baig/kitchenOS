'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api, idemKey } from '@/lib/api';
import { useApi, useNow } from '@/lib/hooks';
import { beep, useStaffEvents } from '@/lib/socket';
import { ago, money, titleCase } from '@/lib/format';
import { useSession } from '@/components/Session';
import { Drawer, Empty, PageHead, Status, Tabs, useAction } from '@/components/ui';
import { ItemOptions, MenuGrid, toApiLines, type CartLine } from '@/components/MenuPicker';
import { OrderDrawer } from '@/components/OrderDrawer';

export default function Waiter() {
  const s = useSession();
  const [tab, setTab] = useState<'ready' | 'tables' | 'requests' | 'tasks'>('ready');
  const now = useNow(15000);
  const ready = useApi<any>('/r/orders?status=ready&withItems=1&pageSize=100');
  const tables = useApi<any>('/r/tables-overview');
  const reqs = useApi<any>('/r/support');
  const tasks = useApi<any>('/r/tasks?mine=1');
  const [run, busy] = useAction();
  const [newOrder, setNewOrder] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [issue, setIssue] = useState(false);
  const reloadAll = () => { ready.reload(); tables.reload(); reqs.reload(); tasks.reload(); };
  useStaffEvents({ 'order:updated': (p) => { if (p.status === 'ready') beep(); ready.reload(); tables.reload(); }, 'order:new': () => tables.reload(), 'support:new': () => { beep(); reqs.reload(); }, 'support:updated': () => reqs.reload(), 'task:new': () => tasks.reload(), notification: (n) => { if (n.type === 'task_assigned') tasks.reload(); } }, reloadAll);
  const mine = (t: any) => !t.waiter_user_id || t.waiter_user_id === s.user.id;
  const openReq = (reqs.data?.data || []).filter((r: any) => r.status !== 'resolved');
  const openTasks = (tasks.data?.data || []).filter((t: any) => !['completed', 'cancelled'].includes(t.status));
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <PageHead title="Waiter" actions={<><button className="btn" onClick={() => setIssue(true)}>Report issue</button><button className="btn btn-primary" onClick={() => setNewOrder(true)}><Plus size={16} /> New order</button></>} />
      <Tabs value={tab} onChange={setTab} items={[{ value: 'ready', label: 'Ready to serve', count: ready.data?.data.length }, { value: 'tables', label: 'Tables' }, { value: 'requests', label: 'Requests', count: openReq.length }, { value: 'tasks', label: 'Tasks', count: openTasks.length }]} />
      {tab === 'ready' && ((ready.data?.data || []).length === 0 ? <Empty title="Nothing waiting to be served" /> : <div className="stack">{ready.data.data.map((o: any) => (
        <div key={o.id} className="card row-between"><div><strong>{o.table_name || titleCase(o.order_type)}</strong> · {o.order_no} <span className="tiny muted">ready {ago(o.ready_at || o.created_at, now)} ago</span><div className="small muted">{(o.items || []).map((i: any) => `${i.quantity}× ${i.name}`).join(', ')}</div></div>
          <button className="btn btn-primary" disabled={busy} onClick={async () => { await run(() => api(`/r/orders/${o.id}/status`, { body: { status: 'served' } }), 'Served'); ready.reload(); }}>Served</button></div>))}</div>)}
      {tab === 'tables' && <div className="grid grid-auto">{(tables.data?.data || []).filter(mine).map((t: any) => (
        <div key={t.id} className="card card-tight stack" style={{ gap: 6 }}>
          <div className="row-between"><strong>{t.name}</strong>{t.open_requests > 0 ? <span className="badge badge-warning">{t.open_requests} request</span> : t.session_id || t.open_bill_id ? <span className="badge badge-info">Occupied</span> : <span className="badge badge-success">Free</span>}</div>
          <div className="small muted">{t.customer_name || '—'} · seats {t.capacity}{t.session_pin ? ` · PIN ${t.session_pin}` : ''}</div>
          {t.open_bill_total && <div className="small">Bill {money(t.open_bill_total, s.currency)}</div>}
        </div>))}</div>}
      {tab === 'requests' && (openReq.length === 0 ? <Empty title="No open requests" /> : <div className="stack">{openReq.map((r: any) => (
        <div key={r.id} className="card row-between"><div><strong>{r.table_name || 'Online'}</strong> · {titleCase(r.type)} <Status value={r.status} /><div className="small muted">{r.customer_name}{r.message ? ` — ${r.message}` : ''} · {ago(r.created_at, now)} ago</div></div>
          <div className="row">{r.status === 'open' && <button className="btn" onClick={async () => { await run(() => api(`/r/support/${r.id}/status`, { body: { status: 'acknowledged' } })); reqs.reload(); }}>On my way</button>}<button className="btn btn-primary" onClick={async () => { await run(() => api(`/r/support/${r.id}/status`, { body: { status: 'resolved' } }), 'Resolved'); reqs.reload(); }}>Done</button></div></div>))}</div>)}
      {tab === 'tasks' && (openTasks.length === 0 ? <Empty title="No tasks" /> : <div className="stack">{openTasks.map((t: any) => (
        <div key={t.id} className="card row-between"><div><strong>{t.title}</strong> <Status value={t.status} /><div className="small muted">{t.table_name ? `${t.table_name} · ` : ''}{t.details}</div></div>
          <div className="row">{t.status === 'assigned' && <button className="btn" onClick={async () => { await run(() => api(`/r/tasks/${t.id}/status`, { body: { status: 'accepted' } })); tasks.reload(); }}>Accept</button>}
            {['assigned', 'accepted'].includes(t.status) && <button className="btn" onClick={async () => { await run(() => api(`/r/tasks/${t.id}/status`, { body: { status: 'in_progress' } })); tasks.reload(); }}>Start</button>}
            <button className="btn btn-primary" onClick={async () => { await run(() => api(`/r/tasks/${t.id}/status`, { body: { status: 'completed' } }), 'Completed'); tasks.reload(); }}>Complete</button></div></div>))}</div>)}
      <NewOrder open={newOrder} onClose={() => setNewOrder(false)} tables={(tables.data?.data || [])} onCreated={(id) => { setNewOrder(false); setSel(id); tables.reload(); }} />
      <IssueForm open={issue} onClose={() => setIssue(false)} tables={tables.data?.data || []} />
      <OrderDrawer id={sel} onClose={() => setSel(null)} onChanged={reloadAll} />
    </div>
  );
}

function NewOrder({ open, onClose, tables, onCreated }: { open: boolean; onClose: () => void; tables: any[]; onCreated: (id: number) => void }) {
  const s = useSession();
  const menu = useApi<any>(open ? '/r/menu' : null);
  const [tableId, setTableId] = useState('');
  const [name, setName] = useState('');
  const [lines, setLines] = useState<CartLine[]>([]);
  const [pick, setPick] = useState<any>(null);
  const [run, busy] = useAction();
  const total = lines.reduce((a, l) => a + l.unit * l.quantity, 0);
  return (
    <Drawer open={open} title="New order for a guest" onClose={onClose} footer={<><span className="grow small">{lines.length} line(s) · {money(total, s.currency)} before tax</span><button className="btn btn-primary" disabled={busy || !tableId || !name || !lines.length} onClick={async () => {
      const r = await run(() => api('/r/orders', { body: { tableId: Number(tableId), customerName: name, lines: toApiLines(lines), idempotencyKey: idemKey(), orderType: 'dine_in', channel: 'waiter' } }), 'Order sent to kitchen');
      if (r) { setLines([]); setName(''); onCreated(r.data.id); }
    }}>Send order</button></>}>
      <div className="form-grid mb">
        <label className="field">Table<select className="input" value={tableId} onChange={(e) => setTableId(e.target.value)}><option value="">Choose…</option>{tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label className="field">Guest name<input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
      </div>
      {lines.map((l) => <div key={l.key} className="row-between small" style={{ padding: '4px 0' }}><span>{l.quantity}× {l.name}{l.variantName ? ` (${l.variantName})` : ''}{l.notes ? ` — ${l.notes}` : ''}</span><button className="btn btn-sm btn-ghost" onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>Remove</button></div>)}
      <hr />
      <MenuGrid menu={menu.data?.data} currency={s.currency} onPick={setPick} />
      {pick && <ItemOptions item={pick} currency={s.currency} onAdd={(l) => setLines([...lines, l])} onClose={() => setPick(null)} />}
    </Drawer>
  );
}

function IssueForm({ open, onClose, tables }: { open: boolean; onClose: () => void; tables: any[] }) {
  const [f, setF] = useState({ title: '', details: '', tableId: '' });
  const [run, busy] = useAction();
  return (
    <Drawer open={open} title="Report a table issue" onClose={onClose} footer={<button className="btn btn-primary" disabled={busy || f.title.length < 2} onClick={async () => { const r = await run(() => api('/r/tasks', { body: { kind: 'issue', title: f.title, details: f.details || null, tableId: f.tableId ? Number(f.tableId) : null } }), 'Issue reported to managers'); if (r) { setF({ title: '', details: '', tableId: '' }); onClose(); } }}>Report</button>}>
      <div className="stack">
        <label className="field">Table<select className="input" value={f.tableId} onChange={(e) => setF({ ...f, tableId: e.target.value })}><option value="">—</option>{tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label className="field">What is wrong?<input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. wobbly table, spilled drink" /></label>
        <label className="field">Details<textarea className="input" value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} /></label>
      </div>
    </Drawer>
  );
}
