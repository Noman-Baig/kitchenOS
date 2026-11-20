'use client';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { api } from '@/lib/api';
import { SessionCtx, type Me } from './Session';
import { Skeleton } from './ui';

/** Loads the server session; redirects to login, the right area, or the suspension page. */
export function AuthGate({ area, children }: { area: 'restaurant' | 'platform'; children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const path = usePathname();
  const load = useCallback(async () => {
    try {
      const m = await api('/auth/me');
      if (!m.user) { location.href = `/login?next=${encodeURIComponent(location.pathname)}`; return; }
      if (area === 'restaurant' && m.user.isSuperAdmin) { location.href = '/admin'; return; }
      if (area === 'platform' && !m.user.isSuperAdmin) { location.href = '/dashboard'; return; }
      setMe(m);
    } catch { location.href = '/login'; }
  }, [area]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!me?.restaurant || me.restaurant.availability?.available) return;
    if (!path.startsWith('/dashboard/subscription')) {
      sessionStorage.setItem('um_suspension', JSON.stringify(me.restaurant.suspension || {}));
      location.href = '/suspended';
    }
  }, [me, path]);
  if (!me) return <div style={{ padding: 40, maxWidth: 600 }}><Skeleton rows={6} /></div>;
  return <SessionCtx.Provider value={{ me, reload: load }}>{children}</SessionCtx.Provider>;
}
