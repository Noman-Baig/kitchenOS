'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { money } from '@/lib/format';
import { Drawer, PageHead, Status, useAction } from '@/components/ui';

export default function Plans() {
  const { data, reload } = useApi<any>('/platform/plans');
  const [e, setE] = useState<any>(null);
  const [run, busy] = useAction();
  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <PageHead title="Subscription plans" actions={<button className="btn btn-primary" onClick={() => setE({ name: '', description: '', price: '', currency: 'USD', durationDays: 30, maxBranches: 1, features: '', sortOrder: 0, active: true })}><Plus size={16} /> New plan</button>} />
      {!data ? <div className="skeleton" /> : <div className="table-wrap"><table className="table"><thead><tr><th>Plan</th><th className="num">Price</th><th>Duration</th><th>Branches</th><th>Status</th></tr></thead>
        <tbody>{data.data.map((p: any) => { const feats = typeof p.features === 'string' ? JSON.parse(p.features || '[]') : p.features || []; return <tr key={p.id} className="clickable" onClick={() => setE({ id: p.id, name: p.name, description: p.description || '', price: p.price, currency: p.currency, durationDays: p.duration_days, maxBranches: p.max_branches, features: feats.join('\n'), sortOrder: p.sort_order, active: !!p.active })}><td><strong>{p.name}</strong><div className="tiny muted">{p.description}</div></td><td className="num">{money(p.price, p.currency)}</td><td>{p.duration_days} days</td><td>{p.max_branches}</td><td><Status value={p.active ? 'active' : 'draft'} /></td></tr>; })}</tbody></table></div>}
      <Drawer open={!!e} title={e?.id ? 'Edit plan' : 'New plan'} onClose={() => setE(null)} footer={<button className="btn btn-primary" disabled={busy || !e?.name || e?.price === ''} onClick={async () => {
        const body = { name: e.name, description: e.description || null, price: String(e.price), currency: e.currency, durationDays: Number(e.durationDays), maxBranches: Number(e.maxBranches), features: e.features.split('\n').map((x: string) => x.trim()).filter(Boolean), sortOrder: Number(e.sortOrder), active: e.active };
        const r = await run(() => (e.id ? api(`/platform/plans/${e.id}`, { method: 'PATCH', body }) : api('/platform/plans', { body })), 'Plan saved'); if (r) { setE(null); reload(); }
      }}>Save</button>}>
        {e && <div className="form-grid">
          <label className="field">Name<input className="input" value={e.name} onChange={(x) => setE({ ...e, name: x.target.value })} /></label>
          <label className="field">Currency (ISO)<input className="input" maxLength={3} value={e.currency} onChange={(x) => setE({ ...e, currency: x.target.value.toUpperCase() })} /></label>
          <label className="field">Price<input className="input" type="number" min="0" step="0.01" value={e.price} onChange={(x) => setE({ ...e, price: x.target.value })} /></label>
          <label className="field">Duration (days)<input className="input" type="number" min={1} value={e.durationDays} onChange={(x) => setE({ ...e, durationDays: x.target.value })} /></label>
          <label className="field">Max branches<input className="input" type="number" min={1} value={e.maxBranches} onChange={(x) => setE({ ...e, maxBranches: x.target.value })} /></label>
          <label className="field">Sort order<input className="input" type="number" value={e.sortOrder} onChange={(x) => setE({ ...e, sortOrder: x.target.value })} /></label>
          <label className="field full">Description<input className="input" value={e.description} onChange={(x) => setE({ ...e, description: x.target.value })} /></label>
          <label className="field full">Features (one per line)<textarea className="input" value={e.features} onChange={(x) => setE({ ...e, features: x.target.value })} /></label>
          <label className="check full"><input type="checkbox" checked={e.active} onChange={(x) => setE({ ...e, active: x.target.checked })} /> Available for purchase</label>
        </div>}
      </Drawer>
    </div>
  );
}
