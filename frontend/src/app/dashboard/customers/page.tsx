'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { dt, money } from '@/lib/format';
import { useSession } from '@/components/Session';
import { ResourcePage } from '@/components/ResourcePage';
import { ConfirmButton, Drawer, Status, useAction } from '@/components/ui';

export default function Customers() {
  const s = useSession();
  const [view, setView] = useState<number | null>(null);
  const h = useApi<any>(view ? `/r/customers/${view}/history` : null);
  const [pts, setPts] = useState({ points: '', reason: '' });
  const [run] = useAction();
  return (
    <div className="page">
      <ResourcePage title="Customers" subtitle="Profiles are created when guests provide a phone number. Marketing is only sent to customers who opted in." endpoint="/r/customers" noDelete
        fields={[{ name: 'name', label: 'Name', required: true }, { name: 'phone', label: 'Phone', nullable: true }, { name: 'email', label: 'Email', type: 'email', nullable: true }, { name: 'birthday', label: 'Birthday', type: 'date', nullable: true }, { name: 'recognition_opt_in', label: 'Recognise on return visits', type: 'checkbox' }, { name: 'marketing_opt_in', label: 'Consented to marketing', type: 'checkbox' }, { name: 'notes', label: 'Notes', type: 'textarea', nullable: true }]}
        transform={(d) => ({ ...d, birthday: d.birthday ? String(d.birthday).slice(0, 10) : d.birthday })}
        columns={[{ key: 'name', label: 'Customer', render: (r) => <strong>{r.name}</strong> }, { key: 'phone', label: 'Phone', render: (r) => r.phone || '—' }, { key: 'visit_count', label: 'Visits' }, { key: 'total_spent', label: 'Spent', className: 'num', render: (r) => money(r.total_spent, s.currency) }, { key: 'loyalty_points', label: 'Points', className: 'num' }, { key: 'last_visit_at', label: 'Last visit', render: (r) => dt(r.last_visit_at, s.tz, { dateStyle: 'medium' }) }, { key: 'marketing_opt_in', label: 'Marketing', render: (r) => (r.marketing_opt_in ? <Status value="active" /> : <span className="muted small">No</span>) }]}
        extraActions={(r) => <button className="btn btn-sm" onClick={() => setView(r.id)}>History</button>} />
      <Drawer open={!!view} title={h.data?.data.customer.name || 'Customer'} onClose={() => setView(null)}
        footer={s.can('customers.manage') && view && <ConfirmButton label="Delete personal data" confirm="Anonymise this customer? Name, phone, email and birthday are removed; financial records stay intact." onConfirm={async () => { await run(() => api(`/r/customers/${view}/anonymize`, { body: {} }), 'Customer anonymised'); h.reload(); }} className="btn" />}>
        {h.data && <div className="stack">
          <div className="grid grid-3"><div><div className="small muted">Visits</div><strong>{h.data.data.customer.visit_count}</strong></div><div><div className="small muted">Spent</div><strong>{money(h.data.data.customer.total_spent, s.currency)}</strong></div><div><div className="small muted">Points</div><strong>{h.data.data.customer.loyalty_points}</strong></div></div>
          {s.can('loyalty.manage') && <div className="row"><input className="input" style={{ width: 110 }} type="number" placeholder="± points" value={pts.points} onChange={(e) => setPts({ ...pts, points: e.target.value })} /><input className="input grow" placeholder="Reason" value={pts.reason} onChange={(e) => setPts({ ...pts, reason: e.target.value })} /><button className="btn" disabled={!pts.points || pts.reason.length < 2} onClick={async () => { await run(() => api(`/r/customers/${view}/loyalty`, { body: { points: Number(pts.points), reason: pts.reason } }), 'Points updated'); setPts({ points: '', reason: '' }); h.reload(); }}>Adjust</button></div>}
          <div className="section-title">Bills</div>
          {h.data.data.bills.map((b: any) => <div key={b.id} className="row-between small"><a className="link" href={`/dashboard/bills/${b.id}`}>{b.bill_no}</a><span>{dt(b.opened_at, s.tz, { dateStyle: 'medium' })} · {money(b.total, s.currency)} <Status value={b.status} /></span></div>)}
          <div className="section-title">Loyalty</div>
          {h.data.data.loyalty.map((l: any) => <div key={l.id} className="row-between small"><span>{l.reason}</span><span>{l.points > 0 ? '+' : ''}{l.points}</span></div>)}
          <div className="section-title">Feedback</div>
          {h.data.data.feedback.map((f: any, i: number) => <div key={i} className="small">{'★'.repeat(f.rating)} {f.comment}</div>)}
        </div>}
      </Drawer>
    </div>
  );
}
