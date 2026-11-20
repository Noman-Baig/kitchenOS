'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Bell, LogOut, Menu as MenuIcon, type LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { closeStaffSocket, getStaffSocket, useStaffEvents, useSocketStatus, beep } from '@/lib/socket';
import { ago } from '@/lib/format';
import { BrandMark, ThemeToggle, useBranding } from './Providers';
import { useSession } from './Session';

export type NavItem = { href: string; label: string; icon: LucideIcon; perm?: string; group: string };

export function Shell({ nav, title, children, notificationsPath }: { nav: NavItem[]; title: string; children: ReactNode; notificationsPath: string }) {
  const path = usePathname();
  const b = useBranding();
  const s = useSession();
  const [open, setOpen] = useState(false);
  const [bell, setBell] = useState(false);
  const [notes, setNotes] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const loadNotes = () => api(notificationsPath).then((r) => { setNotes(r.data); setUnread(r.unread ?? r.data.filter((n: any) => !n.read_at).length); }).catch(() => undefined);
  useEffect(() => { void loadNotes(); getStaffSocket(); /* eslint-disable-next-line */ }, []);
  useEffect(() => setOpen(false), [path]);
  useStaffEvents({ notification: (n) => { setNotes((x) => [{ ...n, created_at: new Date().toISOString() }, ...x].slice(0, 100)); setUnread((u) => u + 1); if (['order_new', 'support_request', 'cash_requested', 'payment_submitted'].includes(n.type)) beep(); } }, loadNotes);
  const live = useSocketStatus();
  const items = nav.filter((n) => !n.perm || s.can(n.perm));
  const groups = [...new Set(items.map((i) => i.group))];
  const active = (href: string) => (href === '/dashboard' || href === '/admin' ? path === href : path.startsWith(href));
  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Navigation">
        <div className="brand">{s.restaurant?.logoUrl ? <span className="brand-logo"><img src={s.restaurant.logoUrl} alt="" /></span> : s.restaurant ? <span className="brand-logo">{s.restaurant.name.slice(0, 1).toUpperCase()}</span> : <BrandMark />}<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.restaurant?.name || title}</span></div>
        {groups.map((g) => (
          <div key={g}>
            <div className="nav-group">{g}</div>
            {items.filter((i) => i.group === g).map((i) => <Link key={i.href} href={i.href} className={`nav-link ${active(i.href) ? 'active' : ''}`}><i.icon size={16} />{i.label}</Link>)}
          </div>
        ))}
        <div className="tiny muted" style={{ padding: '18px 10px 4px' }}>Powered by {b.softwareName}</div>
      </aside>
      <div className="main">
        <header className="topbar no-print">
          <div className="row"><button className="btn btn-ghost icon-btn mobile-nav-toggle" onClick={() => setOpen(!open)} aria-label="Open navigation"><MenuIcon size={18} /></button><span className="small muted">{s.user.name}{s.user.role ? ` · ${s.user.role}` : ''}</span><span className={`badge ${live ? 'badge-success' : 'badge-warning'}`} title={live ? 'Real-time updates connected' : 'Reconnecting — screens resync automatically when the connection returns'}>{live ? 'Live' : 'Reconnecting…'}</span></div>
          <div className="row" style={{ gap: 6 }}>
            <div style={{ position: 'relative' }}>
              <button className="btn btn-ghost icon-btn" aria-label={`Notifications (${unread} unread)`} onClick={() => { setBell(!bell); if (!bell && unread) { setUnread(0); void api(`${notificationsPath}/read`, { body: {} }).catch(() => undefined); } }}><Bell size={17} />{unread > 0 && <span className="badge badge-danger" style={{ position: 'absolute', top: -2, right: -4, padding: '0 5px' }}>{unread}</span>}</button>
              {bell && <div className="card" style={{ position: 'absolute', right: 0, top: 40, width: 340, maxHeight: 420, overflowY: 'auto', padding: 0, zIndex: 30 }}>
                {notes.length === 0 ? <div className="empty small">No notifications</div> : notes.slice(0, 40).map((n) => (
                  <div key={n.id + (n.created_at || '')} style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}><div className="row-between"><strong className="small">{n.title}</strong><span className="tiny muted">{n.created_at ? ago(n.created_at) : ''}</span></div>{n.body && <div className="small muted">{n.body}</div>}</div>
                ))}
              </div>}
            </div>
            <ThemeToggle />
            <button className="btn btn-ghost icon-btn" aria-label="Sign out" onClick={async () => { await api('/auth/logout', { body: {} }).catch(() => undefined); closeStaffSocket(); location.href = '/login'; }}><LogOut size={17} /></button>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
