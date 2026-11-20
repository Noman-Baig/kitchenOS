'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useApi, useNow } from '@/lib/hooks';
import { beep, useStaffEvents } from '@/lib/socket';
import { ago, dt, titleCase } from '@/lib/format';
import { useSession } from '@/components/Session';
import { Empty, PageHead, Status, Tabs, useAction } from '@/components/ui';

export default function Support() {
  const s = useSession();
  const now = useNow(15000);
  const [tab, setTab] = useState<'requests' | 'chat' | 'calls'>('requests');
  const reqs = useApi<any>('/r/support');
  const chats = useApi<any>('/r/chats');
  const calls = useApi<any>(tab === 'calls' ? '/r/calls' : null);
  const [sid, setSid] = useState<number | null>(null);
  const thread = useApi<any>(sid ? `/r/chats/${sid}` : null);
  const [msg, setMsg] = useState('');
  const [run] = useAction();
  const end = useRef<HTMLDivElement>(null);
  useStaffEvents({
    'support:new': () => { beep(); reqs.reload(); }, 'support:updated': () => reqs.reload(),
    'chat:message': (m) => { if (m.sender_type === 'customer') beep(); chats.reload(); if (m.sessionId === sid) thread.setData((d: any) => d && !d.data.some((x: any) => x.id === m.id) ? { data: [...d.data, m] } : d); },
  }, () => { reqs.reload(); chats.reload(); if (sid) thread.reload(); });
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [thread.data]);
  const open = (reqs.data?.data || []).filter((r: any) => r.status !== 'resolved');
  return (
    <div className="page">
      <PageHead title="Chat & requests" subtitle="Customer assistance requests, live chat and call history." />
      <Tabs value={tab} onChange={setTab} items={[{ value: 'requests', label: 'Requests', count: open.length }, { value: 'chat', label: 'Live chat', count: (chats.data?.data || []).reduce((a: number, c: any) => a + Number(c.unread || 0), 0) }, { value: 'calls', label: 'Calls' }]} />
      {tab === 'requests' && ((reqs.data?.data || []).length === 0 ? <Empty title="No requests" /> : <div className="table-wrap"><table className="table"><thead><tr><th>Table</th><th>Type</th><th>Customer</th><th>Message</th><th>Waiting</th><th>Status</th><th /></tr></thead>
        <tbody>{reqs.data.data.map((r: any) => <tr key={r.id}><td><strong>{r.table_name || 'Online'}</strong></td><td>{titleCase(r.type)}</td><td>{r.customer_name || '—'}</td><td className="small">{r.message || '—'}</td><td className="small">{ago(r.created_at, now)}</td><td><Status value={r.status} /></td>
          <td className="right nowrap">{r.status === 'open' && <button className="btn btn-sm" onClick={async () => { await run(() => api(`/r/support/${r.id}/status`, { body: { status: 'acknowledged' } })); reqs.reload(); }}>Acknowledge</button>} {r.status !== 'resolved' && <button className="btn btn-sm btn-primary" onClick={async () => { await run(() => api(`/r/support/${r.id}/status`, { body: { status: 'resolved' } }), 'Resolved'); reqs.reload(); }}>Resolve</button>}{r.session_id && <button className="btn btn-sm btn-ghost" onClick={() => { setSid(r.session_id); setTab('chat'); }}>Chat</button>}</td></tr>)}</tbody></table></div>)}
      {tab === 'chat' && <div className="grid" style={{ gridTemplateColumns: '280px minmax(0,1fr)' }}>
        <div className="card" style={{ padding: 0 }}>{(chats.data?.data || []).length === 0 ? <div className="empty small">No conversations today</div> : chats.data.data.map((c: any) => (
          <button key={c.session_id} onClick={() => setSid(c.session_id)} className="btn-ghost" style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 14px', border: 0, borderBottom: '1px solid var(--border)', background: sid === c.session_id ? 'var(--brand-soft)' : 'transparent', cursor: 'pointer', font: 'inherit', color: 'inherit' }}>
            <div className="row-between"><strong className="small">{c.table_name || 'Online'} · {c.customer_name}</strong>{Number(c.unread) > 0 && <span className="badge badge-danger">{c.unread}</span>}</div><div className="tiny muted">{ago(c.last_at, now)} ago</div></button>))}</div>
        <div className="card stack">{!sid ? <Empty title="Select a conversation" /> : <>
          <div className="chat" style={{ maxHeight: '55vh', minHeight: 300 }}>{(thread.data?.data || []).map((m: any) => <div key={m.id} className={`bubble ${m.sender_type === 'staff' ? 'me' : 'them'}`}>{m.body}<div className="tiny" style={{ opacity: .7 }}>{m.sender_type === 'staff' ? m.staff_name || 'Staff' : 'Guest'} · {dt(m.created_at, s.tz, { timeStyle: 'short' })}</div></div>)}<div ref={end} /></div>
          <form className="row" onSubmit={async (e) => { e.preventDefault(); if (!msg.trim()) return; const r = await run(() => api(`/r/chats/${sid}`, { body: { body: msg } })); if (r) { setMsg(''); thread.reload(); } }}><input className="input grow" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Type a reply…" maxLength={2000} aria-label="Message" /><button className="btn btn-primary">Send</button></form>
        </>}</div>
      </div>}
      {tab === 'calls' && (!calls.data ? <div className="skeleton" /> : calls.data.data.length === 0 ? <Empty title="No calls yet" /> : <div className="table-wrap"><table className="table"><thead><tr><th>Started</th><th>Table</th><th>Customer</th><th>Answered by</th><th>Status</th><th>Duration</th><th>End reason</th></tr></thead>
        <tbody>{calls.data.data.map((c: any) => <tr key={c.id}><td className="small">{dt(c.started_at, s.tz)}</td><td>{c.table_name || 'Online'}</td><td>{c.customer_name}</td><td>{c.staff_name || '—'}</td><td><Status value={c.status} /></td><td className="small">{c.answered_at && c.ended_at ? `${Math.round((new Date(c.ended_at).getTime() - new Date(c.answered_at).getTime()) / 1000)}s` : '—'}</td><td className="small">{c.end_reason || '—'}</td></tr>)}</tbody></table></div>)}
    </div>
  );
}
