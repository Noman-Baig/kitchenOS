'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { dt, money, num, titleCase } from '@/lib/format';
import { useSession } from '@/components/Session';
import { ResourcePage, useOptions } from '@/components/ResourcePage';
import { Empty, Modal, Tabs, useAction } from '@/components/ui';

function StockModal({ ing, mode, onClose, onDone, all }: { ing: any; mode: 'delta' | 'count' | 'opening' | 'transfer'; onClose: () => void; onDone: () => void; all: any[] }) {
  const [qty, setQty] = useState(''); const [cost, setCost] = useState(''); const [reason, setReason] = useState(''); const [to, setTo] = useState('');
  const [run, busy] = useAction();
  if (!ing) return null;
  const title = { delta: 'Adjust stock (+/−)', count: 'Stock count', opening: 'Opening stock', transfer: 'Transfer stock' }[mode];
  return (
    <Modal open title={`${title} — ${ing.name}`} onClose={onClose}>
      <div className="stack">
        <div className="small muted">Current: {num(ing.stock_qty, 3)} {ing.unit} · avg cost {Number(ing.avg_cost).toFixed(4)}</div>
        {mode === 'transfer' && <label className="field">To stock item (same unit)<select className="input" value={to} onChange={(e) => setTo(e.target.value)}><option value="">—</option>{all.filter((x) => x.id !== ing.id && x.unit === ing.unit).map((x) => <option key={x.id} value={x.id}>{x.name}{x.branch_id ? ` (branch ${x.branch_id})` : ''}</option>)}</select></label>}
        <label className="field">{mode === 'count' ? 'Counted quantity' : mode === 'delta' ? 'Change (use − for decrease)' : 'Quantity'} ({ing.unit})<input className="input" type="number" step="0.0001" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        {mode === 'opening' && <label className="field">Unit cost<input className="input" type="number" min="0" step="0.000001" value={cost} onChange={(e) => setCost(e.target.value)} /></label>}
        {mode !== 'transfer' && <label className="field">Reason<input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. monthly stock-take" /></label>}
        <button className="btn btn-primary" disabled={busy || qty === '' || (mode !== 'transfer' && reason.length < 2) || (mode === 'transfer' && !to)} onClick={async () => {
          const r = mode === 'transfer'
            ? await run(() => api('/r/inventory/transfer', { body: { fromIngredientId: ing.id, toIngredientId: Number(to), quantity: qty } }), 'Transferred')
            : await run(() => api('/r/inventory/adjust', { body: { ingredientId: ing.id, mode, quantity: qty, unitCost: cost || undefined, reason } }), 'Stock updated');
          if (r) { onDone(); onClose(); }
        }}>Save</button>
      </div>
    </Modal>
  );
}

export default function Inventory() {
  const s = useSession();
  const [tab, setTab] = useState<'items' | 'low' | 'movements'>('items');
  const branches = useOptions('/r/branches');
  const all = useApi<any>('/r/ingredients?pageSize=200');
  const low = useApi<any>(tab === 'low' ? '/r/inventory/low-stock' : null);
  const moves = useApi<any>(tab === 'movements' ? '/r/inventory/movements?pageSize=200' : null);
  const [modal, setModal] = useState<{ ing: any; mode: any } | null>(null);
  const canManage = s.can('inventory.manage');
  return (
    <div className="page">
      <Tabs value={tab} onChange={setTab} items={[{ value: 'items', label: 'Stock items' }, { value: 'low', label: 'Low stock' }, { value: 'movements', label: 'Movements' }]} />
      {tab === 'items' && <ResourcePage title="Stock items" subtitle="Quantities change only through purchases, adjustments, sales, transfers, returns and wastage." endpoint="/r/ingredients" canWrite={canManage} deleteLabel="Archive"
        fields={[{ name: 'name', label: 'Name', required: true }, { name: 'unit', label: 'Unit', required: true, placeholder: 'g, kg, ml, pcs' }, { name: 'sku', label: 'SKU', nullable: true }, { name: 'min_qty', label: 'Minimum level (alert)', type: 'number' }, { name: 'reorder_qty', label: 'Reorder quantity', type: 'number', nullable: true }, { name: 'branch_id', label: 'Branch store', type: 'select', options: branches, nullable: true }, { name: 'is_finished_product', label: 'Finished product (e.g. bottled drink)', type: 'checkbox' }]}
        transform={(d) => ({ ...d, min_qty: d.min_qty !== undefined ? String(d.min_qty) : undefined, reorder_qty: d.reorder_qty !== undefined && d.reorder_qty !== null ? String(d.reorder_qty) : d.reorder_qty })}
        columns={[{ key: 'name', label: 'Item', render: (r) => <strong>{r.name}</strong> }, { key: 'stock_qty', label: 'In stock', className: 'num', render: (r) => <span style={{ color: Number(r.min_qty) > 0 && Number(r.stock_qty) <= Number(r.min_qty) ? 'var(--danger)' : undefined }}>{num(r.stock_qty, 3)} {r.unit}</span> }, { key: 'min_qty', label: 'Min', className: 'num', render: (r) => num(r.min_qty, 3) }, { key: 'avg_cost', label: 'Avg cost', className: 'num', render: (r) => Number(r.avg_cost).toFixed(4) }, { key: 'value', label: 'Value', className: 'num', render: (r) => money(Number(r.stock_qty) * Number(r.avg_cost), s.currency) }]}
        extraActions={(r) => canManage && <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}><button className="btn btn-sm" onClick={() => setModal({ ing: r, mode: 'count' })}>Count</button><button className="btn btn-sm" onClick={() => setModal({ ing: r, mode: 'delta' })}>Adjust</button><button className="btn btn-sm btn-ghost" onClick={() => setModal({ ing: r, mode: 'opening' })}>Opening</button><button className="btn btn-sm btn-ghost" onClick={() => setModal({ ing: r, mode: 'transfer' })}>Transfer</button></div>} />}
      {tab === 'low' && (!low.data ? <div className="skeleton" /> : low.data.data.length === 0 ? <Empty title="No low-stock items" /> : <div className="table-wrap"><table className="table"><thead><tr><th>Item</th><th className="num">Current</th><th className="num">Minimum</th><th className="num">Required</th><th className="num">Daily use (7d)</th><th className="num">Suggested restock</th></tr></thead>
        <tbody>{low.data.data.map((r: any) => <tr key={r.id}><td><strong>{r.name}</strong></td><td className="num">{num(r.stock_qty, 2)} {r.unit}</td><td className="num">{num(r.min_qty, 2)}</td><td className="num">{num(r.requiredQty, 2)}</td><td className="num">{num(r.recentDailyUse, 2)}</td><td className="num"><strong>{num(r.suggestedRestockQty, 2)} {r.unit}</strong></td></tr>)}</tbody></table></div>)}
      {tab === 'movements' && (!moves.data ? <div className="skeleton" /> : moves.data.data.length === 0 ? <Empty title="No stock movements" /> : <div className="table-wrap"><table className="table"><thead><tr><th>When</th><th>Item</th><th>Type</th><th className="num">Qty</th><th className="num">Unit cost</th><th className="num">Balance</th><th>Note</th><th>By</th></tr></thead>
        <tbody>{moves.data.data.map((m: any) => <tr key={m.id}><td className="small nowrap">{dt(m.created_at, s.tz)}</td><td>{m.ingredient}</td><td>{titleCase(m.movement_type)}</td><td className="num" style={{ color: Number(m.quantity) < 0 ? 'var(--danger)' : 'var(--success)' }}>{num(m.quantity, 3)} {m.unit}</td><td className="num">{Number(m.unit_cost).toFixed(4)}</td><td className="num">{num(m.balance_after, 3)}</td><td className="small">{m.note}</td><td className="small">{m.user_name || 'system'}</td></tr>)}</tbody></table></div>)}
      {modal && <StockModal ing={modal.ing} mode={modal.mode} all={all.data?.data || []} onClose={() => setModal(null)} onDone={() => { all.reload(); location.reload(); }} />}
    </div>
  );
}
