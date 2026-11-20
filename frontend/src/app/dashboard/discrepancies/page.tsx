'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { dt, money } from '@/lib/format';
import { useSession } from '@/components/Session';
import { useOptions } from '@/components/ResourcePage';
import { Drawer, Empty, PageHead, useAction } from '@/components/ui';

export default function Discrepancies() {
  const s = useSession();
  const list = useApi<any>('/r/discrepancies');
  const tables = useOptions('/r/tables');
  const staff = useApi<any>('/r/staff');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ customerName: '', tableId: '', amount: '', description: '', reason: '', responsibleUserId: '', occurredAt: new Date().toISOString().slice(0, 16), classification: 'neutral' });
  const [run, busy] = useAction();
  return (
    <div className="page">
      <PageHead title="Billing errors & discrepancies" subtitle="“Loss” reduces profit. “Neutral” is held aside and never silently changes profit. Every reclassification is audited." actions={<button className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Record</button>} />
      {!list.data ? <div className="skeleton" /> : list.data.data.length === 0 ? <Empty title="No discrepancies recorded" /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>When</th><th>Reason</th><th>Customer / table</th><th>Responsible</th><th className="num">Amount</th><th>Classification</th></tr></thead>
          <tbody>{list.data.data.map((d: any) => <tr key={d.id}><td className="small">{dt(d.occurred_at, s.tz)}</td><td>{d.reason}<div className="tiny muted">{d.description}</div></td><td className="small">{d.customer_name || '—'} · {d.table_name || '—'}</td><td className="small">{d.responsible_name || '—'}</td><td className="num">{money(d.amount, s.currency)}</td>
            <td><select className="input" style={{ width: 130 }} value={d.classification} onChange={async (e) => { await run(() => api(`/r/discrepancies/${d.id}/classify`, { body: { classification: e.target.value } }), 'Reclassified'); list.reload(); }} aria-label="Classification"><option value="neutral">Neutral</option><option value="loss">Loss</option></select></td></tr>)}</tbody></table></div>
      )}
      <Drawer open={open} title="Record billing error" onClose={() => setOpen(false)} footer={<button className="btn btn-primary" disabled={busy || !f.amount || f.reason.length < 2} onClick={async () => {
        const r = await run(() => api('/r/discrepancies', { body: { customerName: f.customerName || null, tableId: f.tableId ? Number(f.tableId) : null, amount: f.amount, description: f.description || null, reason: f.reason, responsibleUserId: f.responsibleUserId ? Number(f.responsibleUserId) : null, occurredAt: new Date(f.occurredAt).toISOString(), classification: f.classification } }), 'Recorded');
        if (r) { setOpen(false); list.reload(); }
      }}>Save</button>}>
        <div className="form-grid">
          <label className="field">Customer<input className="input" value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} /></label>
          <label className="field">Table<select className="input" value={f.tableId} onChange={(e) => setF({ ...f, tableId: e.target.value })}><option value="">—</option>{tables.map((t: any) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
          <label className="field">Amount<input className="input" type="number" min="0" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
          <label className="field">When<input className="input" type="datetime-local" value={f.occurredAt} onChange={(e) => setF({ ...f, occurredAt: e.target.value })} /></label>
          <label className="field">Responsible staff<select className="input" value={f.responsibleUserId} onChange={(e) => setF({ ...f, responsibleUserId: e.target.value })}><option value="">—</option>{(staff.data?.data || []).map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label className="field">Classification<select className="input" value={f.classification} onChange={(e) => setF({ ...f, classification: e.target.value })}><option value="neutral">Neutral (unresolved)</option><option value="loss">Loss / expense</option></select></label>
          <label className="field full">Reason<input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. walk-out, till short, wrong item billed" /></label>
          <label className="field full">Description<textarea className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        </div>
      </Drawer>
    </div>
  );
}
