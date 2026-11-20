'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { dt } from '@/lib/format';
import { useSession } from '@/components/Session';
import { Empty, PageHead, Stat, Status, useAction } from '@/components/ui';

export default function Feedback() {
  const s = useSession();
  const [filter, setFilter] = useState({ rating: '', status: '', complaints: false });
  const q = new URLSearchParams({ ...(filter.rating ? { rating: filter.rating } : {}), ...(filter.status ? { status: filter.status } : {}), ...(filter.complaints ? { complaints: '1' } : {}) }).toString();
  const { data, reload } = useApi<any>(`/r/feedback?${q}`);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [run] = useAction();
  const st = data?.stats;
  return (
    <div className="page">
      <PageHead title="Feedback & complaints" subtitle="Private by default. Reviews are published on your website only with the guest’s permission." actions={<>
        <select className="input" style={{ width: 120 }} value={filter.rating} onChange={(e) => setFilter({ ...filter, rating: e.target.value })} aria-label="Rating"><option value="">All ratings</option>{[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>{r} ★</option>)}</select>
        <select className="input" style={{ width: 130 }} value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} aria-label="Status"><option value="">Any status</option><option value="open">Open</option><option value="resolved">Resolved</option></select>
        <label className="check"><input type="checkbox" checked={filter.complaints} onChange={(e) => setFilter({ ...filter, complaints: e.target.checked })} />Complaints only</label></>} />
      {st && <div className="grid grid-4 mb"><Stat label="Responses" value={st.n} /><Stat label="Average rating" value={st.avg_rating ? Number(st.avg_rating).toFixed(2) : '—'} /><Stat label="Food / service" value={`${st.avg_food ? Number(st.avg_food).toFixed(1) : '—'} / ${st.avg_service ? Number(st.avg_service).toFixed(1) : '—'}`} /><Stat label="Open complaints" value={st.open_complaints || 0} /></div>}
      {!data ? <div className="skeleton" /> : data.data.length === 0 ? <Empty title="No feedback yet" /> : <div className="stack">{data.data.map((f: any) => (
        <div key={f.id} className="card">
          <div className="row-between"><div className="row"><strong>{'★'.repeat(f.rating)}{'☆'.repeat(5 - f.rating)}</strong>{f.is_complaint ? <span className="badge badge-danger">Complaint</span> : null}<Status value={f.status} />{f.is_published ? <span className="badge badge-brand">Published</span> : null}</div><span className="small muted">{f.customer_name || 'Guest'} · {f.order_no ? `order ${f.order_no} · ` : ''}{dt(f.created_at, s.tz)}</span></div>
          {(f.food_rating || f.service_rating) && <div className="small muted">Food {f.food_rating || '—'} · Service {f.service_rating || '—'}</div>}
          {f.comment && <p className="mt-s" style={{ marginBottom: 4 }}>{f.comment}</p>}
          {f.suggestion && <p className="small muted">Suggestion: {f.suggestion}</p>}
          {f.internal_note && <div className="alert small">Internal: {f.internal_note}</div>}
          <div className="row mt-s"><input className="input grow" placeholder="Internal response / note" value={notes[f.id] ?? ''} onChange={(e) => setNotes({ ...notes, [f.id]: e.target.value })} />
            <button className="btn" disabled={!notes[f.id]} onClick={async () => { await run(() => api(`/r/feedback/${f.id}`, { method: 'PATCH', body: { internalNote: notes[f.id] } }), 'Saved'); reload(); }}>Save note</button>
            {f.status === 'open' && <button className="btn btn-primary" onClick={async () => { await run(() => api(`/r/feedback/${f.id}`, { method: 'PATCH', body: { status: 'resolved' } }), 'Resolved'); reload(); }}>Resolve</button>}
            {f.publish_permission ? <button className="btn btn-ghost" onClick={async () => { await run(() => api(`/r/feedback/${f.id}`, { method: 'PATCH', body: { isPublished: !f.is_published } }), f.is_published ? 'Unpublished' : 'Published'); reload(); }}>{f.is_published ? 'Unpublish' : 'Publish on website'}</button> : null}</div>
        </div>))}</div>}
    </div>
  );
}
