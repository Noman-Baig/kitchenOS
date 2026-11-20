'use client';
import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { dateOnly, money, titleCase } from '@/lib/format';
import { useSession } from '@/components/Session';
import { Drawer, Empty, PageHead, useAction } from '@/components/ui';

export default function Purchases() {
  const s = useSession();
  const list = useApi<any>('/r/purchases?pageSize=100');
  const ings = useApi<any>('/r/ingredients?pageSize=200');
  const sups = useApi<any>('/r/suppliers?pageSize=200');
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<number | null>(null);
  const detail = useApi<any>(view ? `/r/purchases/${view}` : null);
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState<any>({ supplierId: '', reference: '', purchaseDate: today, extraCharges: '0', paidVia: 'cash', notes: '', lines: [] as any[] });
  const [run, busy] = useAction();
  const goods = f.lines.reduce((a: number, l: any) => a + Number(l.quantity || 0) * Number(l.unitCost || 0), 0);
  return (
    <div className="page">
      <PageHead title="Purchases" subtitle="Receiving stock updates quantities, weighted-average cost and the ledger." actions={s.can('inventory.manage') && <button className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Receive purchase</button>} />
      {!list.data ? <div className="skeleton" /> : list.data.data.length === 0 ? <Empty title="No purchases recorded" /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Date</th><th>Reference</th><th>Supplier</th><th>Paid via</th><th className="num">Extra charges</th><th className="num">Total</th><th>By</th></tr></thead>
          <tbody>{list.data.data.map((p: any) => <tr key={p.id} className="clickable" onClick={() => setView(p.id)}><td>{dateOnly(p.purchase_date)}</td><td>{p.reference || `#${p.id}`}</td><td>{p.supplier_name || '—'}</td><td>{titleCase(p.paid_via)}</td><td className="num">{money(p.extra_charges, s.currency)}</td><td className="num"><strong>{money(p.total, s.currency)}</strong></td><td className="small">{p.created_by_name}</td></tr>)}</tbody></table></div>
      )}
      <Drawer open={!!view} title={`Purchase ${detail.data?.data?.reference || ''}`} onClose={() => setView(null)}>
        {detail.data && <div className="table-wrap"><table className="table"><thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Unit cost</th><th className="num">Landed cost</th></tr></thead><tbody>{detail.data.data.lines.map((l: any) => <tr key={l.id}><td>{l.name}</td><td className="num">{Number(l.quantity)} {l.unit}</td><td className="num">{Number(l.unit_cost).toFixed(4)}</td><td className="num">{Number(l.landed_unit_cost).toFixed(4)}</td></tr>)}</tbody></table></div>}
      </Drawer>
      <Drawer open={open} title="Receive purchase" onClose={() => setOpen(false)} footer={<><span className="grow small">Goods {money(goods, s.currency)} + extras {money(f.extraCharges || 0, s.currency)} = <strong>{money(goods + Number(f.extraCharges || 0), s.currency)}</strong></span><button className="btn btn-primary" disabled={busy || !f.lines.length} onClick={async () => {
        const r = await run(() => api('/r/purchases', { body: { ...f, supplierId: f.supplierId ? Number(f.supplierId) : null, reference: f.reference || null, notes: f.notes || null, extraCharges: String(f.extraCharges || '0'), lines: f.lines.map((l: any) => ({ ingredientId: Number(l.ingredientId), quantity: String(l.quantity), unitCost: String(l.unitCost) })) } }), 'Purchase received');
        if (r) { setOpen(false); setF({ ...f, lines: [], reference: '', notes: '', extraCharges: '0' }); list.reload(); }
      }}>Receive</button></>}>
        <div className="form-grid">
          <label className="field">Supplier<select className="input" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}><option value="">—</option>{(sups.data?.data || []).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label className="field">Reference / invoice no.<input className="input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
          <label className="field">Date<input className="input" type="date" value={f.purchaseDate} onChange={(e) => setF({ ...f, purchaseDate: e.target.value })} /></label>
          <label className="field">Paid via<select className="input" value={f.paidVia} onChange={(e) => setF({ ...f, paidVia: e.target.value })}><option value="cash">Cash</option><option value="bank">Bank</option><option value="credit">On credit (payable)</option></select></label>
          <label className="field">Extra charges (delivery etc.)<input className="input" type="number" min="0" step="0.01" value={f.extraCharges} onChange={(e) => setF({ ...f, extraCharges: e.target.value })} /></label>
          <label className="field">Notes<input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        </div>
        <div className="section-title">Lines</div>
        {f.lines.map((l: any, i: number) => <div key={i} className="row mb">
          <select className="input grow" value={l.ingredientId} onChange={(e) => setF({ ...f, lines: f.lines.map((x: any, j: number) => j === i ? { ...x, ingredientId: e.target.value } : x) })}>{(ings.data?.data || []).map((x: any) => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}</select>
          <input className="input" style={{ width: 100 }} type="number" min="0" step="0.0001" placeholder="Qty" value={l.quantity} onChange={(e) => setF({ ...f, lines: f.lines.map((x: any, j: number) => j === i ? { ...x, quantity: e.target.value } : x) })} />
          <input className="input" style={{ width: 110 }} type="number" min="0" step="0.000001" placeholder="Unit cost" value={l.unitCost} onChange={(e) => setF({ ...f, lines: f.lines.map((x: any, j: number) => j === i ? { ...x, unitCost: e.target.value } : x) })} />
          <button className="btn btn-ghost icon-btn" onClick={() => setF({ ...f, lines: f.lines.filter((_: any, j: number) => j !== i) })} aria-label="Remove"><Trash2 size={15} /></button>
        </div>)}
        <button className="btn" disabled={!(ings.data?.data || []).length} onClick={() => setF({ ...f, lines: [...f.lines, { ingredientId: ings.data.data[0].id, quantity: '', unitCost: '' }] })}>+ Add line</button>
      </Drawer>
    </div>
  );
}
