'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { dt } from '@/lib/format';
import { Drawer, PageHead, Status, useAction } from '@/components/ui';

export default function Agreements() {
  const { data, reload } = useApi<any>('/platform/agreements');
  const [e, setE] = useState<any>(null);
  const [view, setView] = useState<number | null>(null);
  const doc = useApi<any>(view ? `/platform/agreements/${view}` : null);
  const [run, busy] = useAction();
  return (
    <div className="page" style={{ maxWidth: 1000 }}>
      <PageHead title="Platform agreements" subtitle="Publishing a new material version asks every restaurant to re-accept it. Legal effect varies by jurisdiction — obtain local legal review." actions={<button className="btn btn-primary" onClick={async () => { const cur = data?.data.find((a: any) => a.is_current); const body = cur ? (await api(`/platform/agreements/${cur.id}`)).data.body : ''; setE({ version: '', title: 'Platform Subscription and Services Agreement', body, isMaterial: true, makeCurrent: true }); }}><Plus size={16} /> New version</button>} />
      {!data ? <div className="skeleton" /> : <div className="table-wrap"><table className="table"><thead><tr><th>Version</th><th>Title</th><th>Material</th><th>Status</th><th>Created</th><th /></tr></thead>
        <tbody>{data.data.map((a: any) => <tr key={a.id}><td className="mono">{a.version}</td><td className="clickable" onClick={() => setView(a.id)}>{a.title}</td><td>{a.is_material ? 'Yes' : 'No'}</td><td>{a.is_current ? <Status value="active" /> : <span className="muted small">archived</span>}</td><td className="small">{dt(a.created_at)}</td><td className="right">{!a.is_current && <button className="btn btn-sm" onClick={async () => { await run(() => api(`/platform/agreements/${a.id}/make-current`, { body: {} }), 'Now current'); reload(); }}>Make current</button>}</td></tr>)}</tbody></table></div>}
      <Drawer open={!!view} title={doc.data?.data.title || 'Agreement'} onClose={() => setView(null)}><div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{doc.data?.data.body}</div></Drawer>
      <Drawer open={!!e} title="New agreement version" onClose={() => setE(null)} footer={<button className="btn btn-primary" disabled={busy || !e?.version || (e?.body || '').length < 50} onClick={async () => { const r = await run(() => api('/platform/agreements', { body: e }), 'Published'); if (r) { setE(null); reload(); } }}>Publish</button>}>
        {e && <div className="stack">
          <div className="form-grid"><label className="field">Version<input className="input" value={e.version} onChange={(x) => setE({ ...e, version: x.target.value })} placeholder="1.1" /></label><label className="field">Title<input className="input" value={e.title} onChange={(x) => setE({ ...e, title: x.target.value })} /></label></div>
          <label className="field">Text<textarea className="input" style={{ minHeight: 360, fontFamily: 'var(--mono)', fontSize: 12.5 }} value={e.body} onChange={(x) => setE({ ...e, body: x.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={e.isMaterial} onChange={(x) => setE({ ...e, isMaterial: x.target.checked })} /> Material change (restaurants must re-accept)</label>
          <label className="check"><input type="checkbox" checked={e.makeCurrent} onChange={(x) => setE({ ...e, makeCurrent: x.target.checked })} /> Make this the current version</label>
        </div>}
      </Drawer>
    </div>
  );
}
