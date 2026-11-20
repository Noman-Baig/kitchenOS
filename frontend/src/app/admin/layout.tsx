'use client';
import { BarChart3, Building2, CreditCard, FileSignature, Gauge, Layers, Server, Settings } from 'lucide-react';
import { AuthGate } from '@/components/AuthGate';
import { Shell, type NavItem } from '@/components/Shell';

const NAV: NavItem[] = [
  { group: 'Platform', href: '/admin', label: 'Overview', icon: Gauge },
  { group: 'Platform', href: '/admin/restaurants', label: 'Restaurants', icon: Building2 },
  { group: 'Platform', href: '/admin/payments', label: 'Subscription payments', icon: CreditCard },
  { group: 'Platform', href: '/admin/reports', label: 'Reports', icon: BarChart3 },
  { group: 'Configuration', href: '/admin/plans', label: 'Plans', icon: Layers },
  { group: 'Configuration', href: '/admin/agreements', label: 'Agreements', icon: FileSignature },
  { group: 'Configuration', href: '/admin/settings', label: 'Branding & settings', icon: Settings },
  { group: 'Configuration', href: '/admin/operations', label: 'Backups & operations', icon: Server },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AuthGate area="platform"><Shell nav={NAV} title="Super Admin" notificationsPath="/platform/notifications">{children}</Shell></AuthGate>;
}
