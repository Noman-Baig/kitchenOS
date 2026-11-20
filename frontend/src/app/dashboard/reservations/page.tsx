'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useStaffEvents } from '@/lib/socket';
import { dt } from '@/lib/format';
import { useSession } from '@/components/Session';
import { ResourcePage, useOptions } from '@/components/ResourcePage';
import { Drawer, Empty, PageHead, Status, Tabs, useAction } from '@/components/ui';

const NEXT: Record<string, string[]> = { requested: ['confirmed', 'rejected'], confirmed: ['arrived', 'no_show', 'cancelled'], arrived: ['completed'], rejected: [], cancelled: [], completed: [], no_show: [] };

export default function Reservations() {
  const s = useSession();
  const [tab, setTab] = useState<'upcoming' | 'waitlist'>('upcoming');
  const list = useApi<any>('/r/reservations');
  const tables = useOptions('/r/tables');
  const [edit, setEdit] = useState<any>(null);
  const [run, busy] = useAction();
  useStaffEvents({ notification: (n) => { if (n.type === 'reservation' || n.type === 'reservation_upcoming') list.reload(); } }, list.reload);
  const save = async () => {
    const body = { customerName: edit.customerName, phone: edit.phone || null, email: edit.email || '', partySize: Number(edit.partySize), reservedFor: new Date(edit.reservedFor).toISOString(), durationMinutes: Number(edit.durationMinutes || 90), tableId: edit.tableId ? Number(edit.tableId) : null, specialRequests: edit.specialRequests || null, source: edit.source || 'staff' };
    const r = await run(() => (edit.id ? api(`/r/reservations/${edit.id}`, { method: 'PATCH', body }) : api('/r/reservations', { body })), 'Saved');
    if (r) { setEdit(null); list.reload(); }
  };
  const local = (v: string) => { const d = new Date(v); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  return (
    <div className="page">
      <Tabs value={tab} onChange={setTab} items={[{ value: 'upcoming', label: 'Reservations' }, { value: 'waitlist', label: 'Waiting list' }]} />
      {tab === 'upcoming' ? <>
        <PageHead title="Reservations" subtitle="Online requests and staff bookings. Overlapping bookings on the same table are prevented." actions={<button className="btn btn-primary" onClick={() => setEdit({ customerName: '', phone: '', partySize: 2, reservedFor: local(new Date(Date.now() + 3600000).toISOString()), durationMinutes: 90, tableId: '', source: 'phone' })}><Plus size={16} /> New booking</button>} />
        {!list.data ? <div className="skeleton" /> : list.data.data.length === 0 ? <Empty title="No upcoming reservations" /> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>When</th><th>Guest</th><th>Party</th><th>Table</th><th>Status</th><th>Notes</th><th /></tr></thead>
            <tbody>{list.data.data.map((r: any) => <tr key={r.id}><td className="nowrap">{dt(r.reserved_for, s.tz)}</td><td className="clickable" onClick={() => setEdit({ id: r.id, customerName: r.customer_name, phone: r.phone, email: r.email, partySize: r.party_size, reservedFor: local(r.reserved_for), durationMinutes: r.duration_minutes, tableId: r.table_id || '', specialRequests: r.special_requests })}><strong>{r.customer_name}</strong><div className="tiny muted">{r.phone} · {r.source}</div></td><td>{r.party_size}</td><td>{r.table_name || <span className="muted">unassigned</span>}</td><td><Status value={r.status} /></td><td className="small">{r.special_requests}</td>
              <td className="right nowrap">{NEXT[r.status].map((n) => <button key={n} className={`btn btn-sm ${n === 'confirmed' || n === 'arrived' ? 'btn-primary' : ''}`} style={{ marginLeft: 4 }} onClick={async () => { await run(() => api(`/r/reservations/${r.id}`, { method: 'PATCH', body: { status: n } }), 'Updated'); list.reload(); }}>{n === 'no_show' ? 'No-show' : n[0].toUpperCase() + n.slice(1)}</button>)}</td></tr>)}</tbody></table></div>
        )}
      </> : <ResourcePage title="Waiting list" endpoint="/r/waitlist" searchable={false}
        fields={[{ name: 'customer_name', label: 'Name', required: true }, { name: 'phone', label: 'Phone', nullable: true }, { name: 'party_size', label: 'Party size', type: 'number', required: true }, { name: 'status', label: 'Status', type: 'select', options: [{ value: 'waiting', label: 'Waiting' }, { value: 'notified', label: 'Notified' }, { value: 'seated', label: 'Seated' }, { value: 'left', label: 'Left' }] }, { name: 'notes', label: 'Notes', nullable: true }]}
        defaults={{ party_size: 2, status: 'waiting' }}
        columns={[{ key: 'customer_name', label: 'Guest', render: (r) => <strong>{r.customer_name}</strong> }, { key: 'party_size', label: 'Party' }, { key: 'phone', label: 'Phone', render: (r) => r.phone || '—' }, { key: 'status', label: 'Status', render: (r) => <Status value={r.status} /> }, { key: 'created_at', label: 'Since', render: (r) => dt(r.created_at, s.tz, { timeStyle: 'short' }) }]} />}
      <Drawer open={!!edit} title={edit?.id ? 'Edit reservation' : 'New reservation'} onClose={() => setEdit(null)} footer={<button className="btn btn-primary" disabled={busy || !edit?.customerName} onClick={save}>Save</button>}>
        {edit && <div className="form-grid">
          <label className="field">Guest name<input className="input" value={edit.customerName} onChange={(e) => setEdit({ ...edit, customerName: e.target.value })} /></label>
          <label className="field">Phone<input className="input" value={edit.phone || ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></label>
          <label className="field">Date & time<input className="input" type="datetime-local" value={edit.reservedFor} onChange={(e) => setEdit({ ...edit, reservedFor: e.target.value })} /></label>
          <label className="field">Duration (min)<input className="input" type="number" min={15} value={edit.durationMinutes} onChange={(e) => setEdit({ ...edit, durationMinutes: e.target.value })} /></label>
          <label className="field">Party size<input className="input" type="number" min={1} value={edit.partySize} onChange={(e) => setEdit({ ...edit, partySize: e.target.value })} /></label>
          <label className="field">Table<select className="input" value={edit.tableId} onChange={(e) => setEdit({ ...edit, tableId: e.target.value })}><option value="">Assign later</option>{tables.map((t: any) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
          <label className="field full">Special requests<textarea className="input" value={edit.specialRequests || ''} onChange={(e) => setEdit({ ...edit, specialRequests: e.target.value })} /></label>
        </div>}
      </Drawer>
    </div>
  );
}
