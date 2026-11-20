'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { api, download } from '@/lib/api';
import { useApi, useDebounced } from '@/lib/hooks';
import { dateOnly } from '@/lib/format';
import { Drawer, Empty, PageHead, Status, useAction } from '@/components/ui';

export default function AdminRestaurants() {
  const [f, setF] = useState({ search: '', status: '', country: '', currency: '', sort: 'created', dir: 'desc' });
  const [page, setPage] = useState(1);
  useEffect(() => { const st = new URLSearchParams(location.search).get('status'); if (st) setF((x) => ({ ...x, status: st })); }, []);
  const q = useDebounced(f.search);
  const qs = new URLSearchParams({ page: String(page), pageSize: '50', ...(q ? { search: q } : {}), ...(f.status ? { status: f.status } : {}), ...(f.country ? { country: f.country } : {}), ...(f.currency ? { currency: f.currency } : {}), sort: f.sort, dir: f.dir }).toString();
  const { data } = useApi<any>(`/platform/restaurants?${qs}`);
  const [reg, setReg] = useState<any>(null);
  const [run, busy] = useAction();
  const sortBy = (k: string) => setF({ ...f, sort: k, dir: f.sort === k && f.dir === 'desc' ? 'asc' : 'desc' });
  return (
    <div className="page">
      <PageHead title="Restaurants" subtitle={data ? `${data.total} restaurants` : ''} actions={<><button className="btn" onClick={() => download(`/platform/restaurants?${qs}&format=csv`, 'restaurants.csv')}><Download size={15} /> Export CSV</button><button className="btn btn-primary" onClick={() => setReg({ name: '', country: '', city: '', timezone: 'UTC', currency: 'USD', email: '', ownerName: '', ownerEmail: '', password: '' })}>Register restaurant</button></>} />
      <div className="row mb">
        <input className="input" style={{ width: 240 }} placeholder="Search name, slug, email, city" value={f.search} onChange={(e) => { setF({ ...f, search: e.target.value }); setPage(1); }} />
        <select className="input" style={{ width: 150 }} value={f.status} onChange={(e) => { setF({ ...f, status: e.target.value }); setPage(1); }} aria-label="Status"><option value="">Any status</option>{['pending', 'active', 'suspended', 'expired', 'rejected'].map((s) => <option key={s}>{s}</option>)}</select>
        <input className="input" style={{ width: 100 }} placeholder="Country" maxLength={2} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value.toUpperCase() })} />
        <input className="input" style={{ width: 100 }} placeholder="Currency" maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} />
      </div>
      {!data ? <div className="skeleton" /> : data.data.length === 0 ? <Empty title="No restaurants match" /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th className="clickable" onClick={() => sortBy('name')}>Restaurant ↕</th><th className="clickable" onClick={() => sortBy('country')}>Country ↕</th><th>Currency</th><th>Plan</th><th>Status</th><th className="clickable" onClick={() => sortBy('expiry')}>Expires ↕</th><th>Branches</th><th className="clickable" onClick={() => sortBy('created')}>Registered ↕</th></tr></thead>
          <tbody>{data.data.map((r: any) => <tr key={r.id} className="clickable" onClick={() => (location.href = `/admin/restaurants/${r.id}`)}><td><Link href={`/admin/restaurants/${r.id}`}><strong>{r.name}</strong></Link><div className="tiny muted">{r.slug} · {r.city}</div></td><td>{r.country}</td><td>{r.currency}</td><td>{r.plan_name || '—'}</td><td><Status value={r.availability.state} />{r.deletion_scheduled_at ? <div className="tiny" style={{ color: 'var(--danger)' }}>deletion {dateOnly(r.deletion_scheduled_at)}</div> : null}</td><td className="small">{dateOnly(r.subscription_expires_at)}</td><td>{r.branch_count}</td><td className="small">{dateOnly(r.created_at)}</td></tr>)}</tbody></table></div>
      )}
      {data && data.total > 50 && <div className="row mt" style={{ justifyContent: 'flex-end' }}><button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span className="small muted">Page {page}</span><button className="btn btn-sm" disabled={page * 50 >= data.total} onClick={() => setPage(page + 1)}>Next</button></div>}
      <Drawer open={!!reg} title="Register a restaurant" onClose={() => setReg(null)} footer={<button className="btn btn-primary" disabled={busy || !reg?.name || reg?.country.length !== 2 || !reg?.email || !reg?.ownerEmail || reg?.password.length < 10} onClick={async () => {
        const r = await run(() => api('/platform/restaurants', { body: { restaurant: { name: reg.name, country: reg.country, city: reg.city || null, timezone: reg.timezone, currency: reg.currency, email: reg.email }, admin: { name: reg.ownerName || reg.name, email: reg.ownerEmail, password: reg.password } } }), 'Restaurant created and approved');
        if (r) location.href = `/admin/restaurants/${r.data.id}`;
      }}>Create</button>}>
        {reg && <div className="form-grid">
          <label className="field">Restaurant name<input className="input" value={reg.name} onChange={(e) => setReg({ ...reg, name: e.target.value })} /></label>
          <label className="field">Restaurant email<input className="input" type="email" value={reg.email} onChange={(e) => setReg({ ...reg, email: e.target.value })} /></label>
          <label className="field">Country (ISO-2)<input className="input" maxLength={2} value={reg.country} onChange={(e) => setReg({ ...reg, country: e.target.value.toUpperCase() })} /></label>
          <label className="field">City<input className="input" value={reg.city} onChange={(e) => setReg({ ...reg, city: e.target.value })} /></label>
          <label className="field">Timezone<input className="input" value={reg.timezone} onChange={(e) => setReg({ ...reg, timezone: e.target.value })} placeholder="Asia/Karachi" /></label>
          <label className="field">Currency<input className="input" maxLength={3} value={reg.currency} onChange={(e) => setReg({ ...reg, currency: e.target.value.toUpperCase() })} /></label>
          <label className="field">Owner name<input className="input" value={reg.ownerName} onChange={(e) => setReg({ ...reg, ownerName: e.target.value })} /></label>
          <label className="field">Owner login email<input className="input" type="email" value={reg.ownerEmail} onChange={(e) => setReg({ ...reg, ownerEmail: e.target.value })} /></label>
          <label className="field full">Temporary password<input className="input" type="text" value={reg.password} onChange={(e) => setReg({ ...reg, password: e.target.value })} /><span className="hint">Share securely; the owner should change it and will be asked to sign the platform agreement on first login.</span></label>
        </div>}
      </Drawer>
    </div>
  );
}
