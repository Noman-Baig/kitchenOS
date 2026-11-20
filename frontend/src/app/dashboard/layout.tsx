'use client';
import { AuthGate } from '@/components/AuthGate';
import { Shell, type NavItem } from '@/components/Shell';
import { IncomingCall } from '@/components/IncomingCall';
import { AgreementBanner } from './AgreementBanner';
import {
  BarChart3, Bell, BookOpen, Boxes, Building2, CalendarDays, ChefHat, ClipboardList, CreditCard, FileWarning, Gauge, Globe, Headphones, HandPlatter,
  Heart, Landmark, LayoutGrid, Monitor, Percent, Printer, QrCode, Receipt, ScrollText, Settings, ShieldCheck, ShoppingCart, Star, Trash2, Truck, UserCog, Users, Wallet, Utensils,
} from 'lucide-react';

const NAV: NavItem[] = [
  { group: 'Operations', href: '/dashboard', label: 'Overview', icon: Gauge, perm: 'dashboard.view' },
  { group: 'Operations', href: '/dashboard/orders', label: 'Orders', icon: ClipboardList, perm: 'orders.view' },
  { group: 'Operations', href: '/dashboard/kitchen', label: 'Kitchen display', icon: ChefHat, perm: 'kitchen.view' },
  { group: 'Operations', href: '/dashboard/waiter', label: 'Waiter', icon: HandPlatter, perm: 'waiter.use' },
  { group: 'Operations', href: '/dashboard/pos', label: 'POS counter', icon: Monitor, perm: 'pos.use' },
  { group: 'Operations', href: '/dashboard/tables', label: 'Tables & QR', icon: QrCode, perm: 'orders.view' },
  { group: 'Operations', href: '/dashboard/support', label: 'Chat & requests', icon: Headphones, perm: 'support.handle' },
  { group: 'Operations', href: '/dashboard/reservations', label: 'Reservations', icon: CalendarDays, perm: 'reservations.manage' },
  { group: 'Billing', href: '/dashboard/bills', label: 'Bills', icon: Receipt, perm: 'billing.view' },
  { group: 'Billing', href: '/dashboard/payments', label: 'Payment approvals', icon: CreditCard, perm: 'payments.approve' },
  { group: 'Billing', href: '/dashboard/discrepancies', label: 'Billing errors', icon: FileWarning, perm: 'discrepancy.manage' },
  { group: 'Menu', href: '/dashboard/menu', label: 'Menu items', icon: Utensils, perm: 'menu.manage' },
  { group: 'Menu', href: '/dashboard/categories', label: 'Categories & stations', icon: LayoutGrid, perm: 'menu.manage' },
  { group: 'Inventory', href: '/dashboard/inventory', label: 'Stock', icon: Boxes, perm: 'inventory.view' },
  { group: 'Inventory', href: '/dashboard/recipes', label: 'Recipes & costing', icon: BookOpen, perm: 'inventory.view' },
  { group: 'Inventory', href: '/dashboard/purchases', label: 'Purchases', icon: ShoppingCart, perm: 'inventory.view' },
  { group: 'Inventory', href: '/dashboard/suppliers', label: 'Suppliers', icon: Truck, perm: 'inventory.manage' },
  { group: 'Inventory', href: '/dashboard/wastage', label: 'Wastage & comps', icon: Trash2, perm: 'wastage.record' },
  { group: 'Customers', href: '/dashboard/customers', label: 'Customers', icon: Users, perm: 'customers.manage' },
  { group: 'Customers', href: '/dashboard/loyalty', label: 'Loyalty & coupons', icon: Heart, perm: 'loyalty.manage' },
  { group: 'Customers', href: '/dashboard/feedback', label: 'Feedback', icon: Star, perm: 'feedback.manage' },
  { group: 'Finance', href: '/dashboard/expenses', label: 'Expenses', icon: Wallet, perm: 'expenses.manage' },
  { group: 'Finance', href: '/dashboard/payroll', label: 'Payroll', icon: Landmark, perm: 'payroll.manage' },
  { group: 'Finance', href: '/dashboard/reports', label: 'Reports', icon: BarChart3, perm: 'reports.view' },
  { group: 'Setup', href: '/dashboard/staff', label: 'Staff & roles', icon: UserCog, perm: 'staff.manage' },
  { group: 'Setup', href: '/dashboard/branches', label: 'Branches', icon: Building2, perm: 'branches.manage' },
  { group: 'Setup', href: '/dashboard/taxes', label: 'Taxes', icon: Percent, perm: 'taxes.manage' },
  { group: 'Setup', href: '/dashboard/payment-methods', label: 'Payment methods', icon: CreditCard, perm: 'settings.manage' },
  { group: 'Setup', href: '/dashboard/printers', label: 'Printers', icon: Printer, perm: 'settings.manage' },
  { group: 'Setup', href: '/dashboard/website', label: 'Website & theme', icon: Globe, perm: 'website.manage' },
  { group: 'Setup', href: '/dashboard/settings', label: 'Settings', icon: Settings, perm: 'settings.manage' },
  { group: 'Setup', href: '/dashboard/subscription', label: 'Subscription', icon: ShieldCheck, perm: 'subscription.manage' },
  { group: 'Setup', href: '/dashboard/audit', label: 'Audit log', icon: ScrollText, perm: 'audit.view' },
  { group: 'Setup', href: '/dashboard/notifications', label: 'Notifications', icon: Bell },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate area="restaurant">
      <Shell nav={NAV} title="Restaurant" notificationsPath="/r/notifications">
        <AgreementBanner />
        {children}
        <IncomingCall />
      </Shell>
    </AuthGate>
  );
}
