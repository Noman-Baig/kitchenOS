'use client';
import { useState } from 'react';
import { api, download } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { dt } from '@/lib/format';
import { PageHead, Status, Tabs, useAction } from '@/components/ui';

export default function Operations() {
  const [tab, setTab] = useState<'backups' | 'jobs' | 'audit' | 'demo'>('backups');
  const backups = useApi<any>(tab === 'backups' ? '/platform/backups' : null);
  const jobs = useApi<any>(tab === 'jobs' ? '/platform/jobs' : null);
  const audit = useApi<any>(tab === 'audit' ? '/platform/audit-logs?pageSize=200' : null);
  const demo = useApi<any>(tab === 'demo' ? '/platform/demo-requests' : null);
  const [run, busy] = useAction();
  const size = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round((n || 0) / 1e3)} KB`);
  return (
    <div className="page">
      <PageHead title="Backups & operations" />
      <Tabs value={tab} onChange={setTab} items={[{ value: 'backups', label: 'Backups' }, { value: 'jobs', label: 'Jobs' }, { value: 'audit', label: 'Audit log' }, { value: 'demo', label: 'Demo requests' }]} />
      {tab === 'backups' && <>
        <div className="row mb"><button className="btn btn-primary" disabled={busy} onClick={async () => { await run(() => api('/platform/backups/run', { body: { kind: 'database' } }), 'Database backup finished'); backups.reload(); }}>Back up database now</button><button className="btn" disabled={busy} onClick={async () => { await run(() => api('/platform/backups/run', { body: { kind: 'storage' } }), 'Storage backup finished'); backups.reload(); }}>Back up files now</button><span className="small muted">Each backup is verified (decompressed and checked) and checksummed. Copy backups off-server regularly.</span></div>
        {backups.data && <div className="table-wrap"><table className="table"><thead><tr><th>Created</th><th>Type</th><th>Status</th><th>Size</th><th>SHA-256</th><th>Verified</th><th /></tr></thead><tbody>{backups.data.data.map((b: any) => <tr key={b.id}><td className="small">{dt(b.created_at)}</td><td>{b.kind}{b.restaurant_id ? ` #${b.restaurant_id}` : ''}</td><td><Status value={b.status} />{b.error && <div className="tiny" style={{ color: 'var(--danger)' }}>{b.error}</div>}</td><td>{size(b.size_bytes)}</td><td className="mono tiny">{b.sha256?.slice(0, 16)}…</td><td className="small">{dt(b.verified_at)}</td><td>{b.status === 'verified' && <button className="btn btn-sm" onClick={() => download(`/platform/backups/${b.id}/download`, b.file_path.split('/').pop())}>Download</button>}</td></tr>)}</tbody></table></div>}
      </>}
      {tab === 'jobs' && jobs.data && <div className="table-wrap"><table className="table"><thead><tr><th>Job</th><th>Run key</th><th>Status</th><th>Started</th><th>Finished</th><th>Info</th></tr></thead><tbody>{jobs.data.data.map((j: any) => <tr key={j.id}><td>{j.job}</td><td className="mono tiny">{j.run_key}</td><td><Status value={j.status} /></td><td className="small">{dt(j.started_at)}</td><td className="small">{dt(j.finished_at)}</td><td className="mono tiny muted" style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{j.info ? (typeof j.info === 'string' ? j.info : JSON.stringify(j.info)) : ''}</td></tr>)}</tbody></table></div>}
      {tab === 'audit' && audit.data && <div className="table-wrap"><table className="table"><thead><tr><th>When</th><th>Actor</th><th>Restaurant</th><th>Action</th><th>Entity</th><th>IP</th></tr></thead><tbody>{audit.data.data.map((a: any) => <tr key={a.id}><td className="small">{dt(a.created_at)}</td><td className="small">{a.user_email || a.actor_type}</td><td>{a.restaurant_id || '—'}</td><td className="mono small">{a.action}</td><td className="small">{a.entity} #{a.entity_id}</td><td className="tiny muted">{a.ip_address}</td></tr>)}</tbody></table></div>}
      {tab === 'demo' && demo.data && <div className="table-wrap"><table className="table"><thead><tr><th>Received</th><th>Name</th><th>Email</th><th>Restaurant</th><th>Message</th><th>Status</th></tr></thead><tbody>{demo.data.data.map((d: any) => <tr key={d.id}><td className="small">{dt(d.created_at)}</td><td>{d.name}<div className="tiny muted">{d.phone}</div></td><td><a className="link" href={`mailto:${d.email}`}>{d.email}</a></td><td>{d.restaurant_name}<div className="tiny muted">{d.country}</div></td><td className="small">{d.message}</td><td><select className="input" value={d.status} onChange={async (e) => { await run(() => api(`/platform/demo-requests/${d.id}`, { method: 'PATCH', body: { status: e.target.value } })); demo.reload(); }}><option value="new">New</option><option value="contacted">Contacted</option><option value="closed">Closed</option></select></td></tr>)}</tbody></table></div>}
    </div>
  );
}
