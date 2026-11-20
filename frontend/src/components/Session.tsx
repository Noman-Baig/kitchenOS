'use client';
import { createContext, useContext } from 'react';

export type Me = {
  user: { id: number; email: string; name: string; isSuperAdmin: boolean; role: string | null; permissions: string[]; branchId: number | null };
  restaurant: null | { id: number; slug: string; name: string; currency: string; timezone: string; locale: string; country: string; logoUrl: string | null; availability: any; suspension: any; pendingAgreement: any };
  branches: { id: number; name: string }[];
};
export const SessionCtx = createContext<{ me: Me; reload: () => void } | null>(null);
export function useSession() {
  const s = useContext(SessionCtx);
  if (!s) throw new Error('useSession outside provider');
  const can = (p: string) => s.me.user.permissions.includes('*') || s.me.user.permissions.includes(p);
  return { ...s.me, can, reload: s.reload, currency: s.me.restaurant?.currency || 'USD', tz: s.me.restaurant?.timezone };
}
