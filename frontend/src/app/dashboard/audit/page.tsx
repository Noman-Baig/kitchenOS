'use client';
import { useState } from 'react';
import { useApi } from '@/lib/hooks';
import { dt } from '@/lib/format';
import { useSession } from '@/components/Session';
import { Empty, PageHead } from '@/components/ui';

export default function Audit() {
  const s = useSession();
  const [page, setPage] = useState(1);
  const { data } = useApi<any>(`/r/audit-logs?page=${page}&pageSize=100`);
  return (
    <div className="page">
      <PageHead title="Audit log" subtitle="Every sensitive and financial action is recorded with who, when and what changed." />
      {!data ? <div className="skeleton" /> : data.data.length === 0 ? <Empty title="No entries" /> : <div className="table-wrap"><table className="table"><thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Details</th><th>IP</th></tr></thead>
        <tbody>{data.data.map((a: any) => <tr key={a.id}><td className="small nowrap">{dt(a.created_at, s.tz, { dateStyle: 'short', timeStyle: 'medium' })}</td><td className="small">{a.user_name || a.actor_type}</td><td className="mono small">{a.action}</td><td className="small">{a.entity} #{a.entity_id}</td><td className="tiny mono muted" style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={JSON.stringify(a.data)}>{a.data ? JSON.stringify(a.data) : ''}</td><td className="tiny muted">{a.ip_address}</td></tr>)}</tbody></table></div>}
      <div className="row mt" style={{ justifyContent: 'flex-end' }}><button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</button><button className="btn btn-sm" disabled={(data?.data.length || 0) < 100} onClick={() => setPage(page + 1)}>Older</button></div>
    </div>
  );
}
