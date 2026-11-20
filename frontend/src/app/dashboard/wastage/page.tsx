'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { dt, money, num, titleCase } from '@/lib/format';
import { useSession } from '@/components/Session';
import { Drawer, Empty, PageHead, Status, useAction } from '@/components/ui';

const KINDS = ['ingredient', 'prepared_food', 'expired', 'damaged', 'complaint', 'complimentary', 'staff_meal', 'kitchen_testing', 'other'];

export default function Wastage() {
  const s = useSession();
  const list = useApi<any>('/r/wastage?pageSize=200');
  const ings = useApi<any>('/r/ingredients?pageSize=200');
  const items = useApi<any>('/r/items?pageSize=200');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ kind: 'expired', target: 'ingredient', ingredientId: '', menuItemId: '', quantity: '', reason: '' });
  const [run, busy] = useAction();
  return (
    <div className="page">
      <PageHead title="Wastage & complimentary items" subtitle="Approved records reduce stock and are expensed at cost. Complimentary items never count as revenue." actions={<button className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Record</button>} />
      {!list.data ? <div className="skeleton" /> : list.data.data.length === 0 ? <Empty title="Nothing recorded" /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>When</th><th>Type</th><th>Item</th><th className="num">Qty</th><th className="num">Cost</th><th>Reason</th><th>Employee</th><th>Status</th><th /></tr></thead>
          <tbody>{list.data.data.map((w: any) => <tr key={w.id}><td className="small nowrap">{dt(w.occurred_at, s.tz)}</td><td>{titleCase(w.kind)}</td><td>{w.ingredient_name || w.menu_item_name}</td><td className="num">{num(w.quantity, 3)} {w.unit || ''}</td><td className="num">{money(w.cost, s.currency)}</td><td className="small">{w.reason}</td><td className="small">{w.employee_name}</td><td><Status value={w.status} /></td>
            <td className="right nowrap">{w.status === 'pending' && s.can('wastage.approve') && <><button className="btn btn-sm btn-primary" onClick={async () => { await run(() => api(`/r/wastage/${w.id}/approve`, { body: {} }), 'Approved — stock updated'); list.reload(); }}>Approve</button> <button className="btn btn-sm" onClick={async () => { await run(() => api(`/r/wastage/${w.id}/reject`, { body: {} }), 'Rejected'); list.reload(); }}>Reject</button></>}</td></tr>)}</tbody></table></div>
      )}
      <Drawer open={open} title="Record wastage or complimentary item" onClose={() => setOpen(false)} footer={<button className="btn btn-primary" disabled={busy || !f.quantity || f.reason.length < 2 || (f.target === 'ingredient' ? !f.ingredientId : !f.menuItemId)} onClick={async () => {
        const r = await run(() => api('/r/wastage', { body: { kind: f.kind, ingredientId: f.target === 'ingredient' ? Number(f.ingredientId) : null, menuItemId: f.target === 'menu' ? Number(f.menuItemId) : null, quantity: f.quantity, reason: f.reason } }), 'Recorded — awaiting approval');
        if (r) { setOpen(false); setF({ ...f, quantity: '', reason: '' }); list.reload(); }
      }}>Submit</button>}>
        <div className="stack">
          <label className="field">Type<select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{KINDS.map((k) => <option key={k} value={k}>{titleCase(k)}</option>)}</select></label>
          <div className="segmented"><button className={f.target === 'ingredient' ? 'active' : ''} onClick={() => setF({ ...f, target: 'ingredient' })}>Ingredient / stock item</button><button className={f.target === 'menu' ? 'active' : ''} onClick={() => setF({ ...f, target: 'menu' })}>Prepared menu item</button></div>
          {f.target === 'ingredient' ? <label className="field">Stock item<select className="input" value={f.ingredientId} onChange={(e) => setF({ ...f, ingredientId: e.target.value })}><option value="">—</option>{(ings.data?.data || []).map((x: any) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}</select></label>
            : <label className="field">Menu item (uses its recipe)<select className="input" value={f.menuItemId} onChange={(e) => setF({ ...f, menuItemId: e.target.value })}><option value="">—</option>{(items.data?.data || []).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
          <label className="field">Quantity<input className="input" type="number" min="0" step="0.0001" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></label>
          <label className="field">Reason<textarea className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></label>
        </div>
      </Drawer>
    </div>
  );
}
