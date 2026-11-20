'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useApi } from '@/lib/hooks';
import { dt } from '@/lib/format';
import { useSession } from '@/components/Session';
import { ResourcePage } from '@/components/ResourcePage';
import { Status, Tabs } from '@/components/ui';

export default function Loyalty() {
  const s = useSession();
  const [tab, setTab] = useState<'coupons' | 'audience'>('coupons');
  const aud = useApi<any>(tab === 'audience' ? '/r/marketing/audience' : null);
  return (
    <div className="page">
      <div className="alert small mb">Points rules (points per {s.currency}, redemption value, minimum) are set in <Link className="link" href="/dashboard/settings">Settings → Loyalty</Link>. Points are awarded automatically when a bill with a known customer is closed.</div>
      <Tabs value={tab} onChange={setTab} items={[{ value: 'coupons', label: 'Coupons & offers' }, { value: 'audience', label: 'Opted-in audience' }]} />
      {tab === 'coupons' ? <ResourcePage title="Coupons" endpoint="/r/coupons"
        fields={[{ name: 'code', label: 'Code', required: true }, { name: 'description', label: 'Description', nullable: true }, { name: 'discount_type', label: 'Type', type: 'select', required: true, options: [{ value: 'percent', label: 'Percent' }, { value: 'fixed', label: 'Fixed amount' }] }, { name: 'value', label: 'Value', type: 'money', required: true }, { name: 'min_order', label: 'Minimum order', type: 'money' }, { name: 'max_uses', label: 'Max uses', type: 'number', nullable: true }, { name: 'starts_at', label: 'Starts', type: 'datetime', nullable: true }, { name: 'ends_at', label: 'Ends', type: 'datetime', nullable: true }, { name: 'birthday_only', label: 'Birthday offer', type: 'checkbox' }, { name: 'active', label: 'Active', type: 'checkbox' }]}
        defaults={{ discount_type: 'percent', min_order: '0', active: true }}
        columns={[{ key: 'code', label: 'Code', render: (r) => <strong className="mono">{r.code}</strong> }, { key: 'value', label: 'Discount', render: (r) => r.discount_type === 'percent' ? `${Number(r.value)}%` : Number(r.value).toFixed(2) }, { key: 'used', label: 'Used', render: (r) => `${r.used_count}${r.max_uses ? ' / ' + r.max_uses : ''}` }, { key: 'ends_at', label: 'Ends', render: (r) => r.ends_at ? dt(r.ends_at, s.tz, { dateStyle: 'medium' }) : '—' }, { key: 'active', label: 'Status', render: (r) => <Status value={r.active ? 'active' : 'draft'} /> }]} />
        : <div><p className="small muted">Only customers who explicitly opted in to marketing are listed. Respect opt-outs and local marketing laws.</p>
          {!aud.data ? <div className="skeleton" /> : <div className="table-wrap"><table className="table"><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Birthday</th><th>Opted in</th></tr></thead><tbody>{aud.data.data.map((c: any) => <tr key={c.id}><td>{c.name}</td><td>{c.phone}</td><td>{c.email || '—'}</td><td>{c.birthday ? String(c.birthday).slice(5, 10) : '—'}</td><td className="small">{dt(c.marketing_opt_in_at, s.tz, { dateStyle: 'medium' })}</td></tr>)}</tbody></table></div>}</div>}
    </div>
  );
}
