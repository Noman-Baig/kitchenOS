'use client';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useStaffEvents } from '@/lib/socket';
import { dt } from '@/lib/format';
import { useSession } from '@/components/Session';
import { Empty, PageHead, useAction } from '@/components/ui';

export default function Notifications() {
  const s = useSession();
  const { data, reload } = useApi<any>('/r/notifications');
  const [run] = useAction();
  useStaffEvents({ notification: reload }, reload);
  return (
    <div className="page" style={{ maxWidth: 800 }}>
      <PageHead title="Notifications" actions={<button className="btn" onClick={async () => { await run(() => api('/r/notifications/read', { body: {} }), 'All marked as read'); reload(); }}>Mark all read</button>} />
      {!data ? <div className="skeleton" /> : data.data.length === 0 ? <Empty title="No notifications" /> : <div className="card" style={{ padding: 0 }}>{data.data.map((n: any) => (
        <div key={n.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: n.read_at ? undefined : 'var(--brand-soft)' }}>
          <div className="row-between"><strong className="small">{n.title}</strong><span className="tiny muted">{dt(n.created_at, s.tz)}</span></div>
          {n.body && <div className="small muted">{n.body}</div>}
        </div>))}</div>}
    </div>
  );
}
