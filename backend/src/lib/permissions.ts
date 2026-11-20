export const PERMISSIONS = {
  'dashboard.view': 'View dashboard',
  'orders.view': 'View orders',
  'orders.create': 'Create orders',
  'orders.manage': 'Accept, reject, modify and cancel orders',
  'kitchen.view': 'View kitchen display',
  'kitchen.update': 'Update preparation status',
  'waiter.use': 'Use waiter app',
  'pos.use': 'Use POS counter',
  'pos.refund': 'Issue refunds',
  'pos.cancel': 'Cancel completed sales',
  'discounts.apply': 'Apply discounts',
  'menu.manage': 'Manage menu',
  'tables.manage': 'Manage tables and QR codes',
  'billing.view': 'View bills and payments',
  'payments.approve': 'Approve or reject payments and record cash',
  'taxes.manage': 'Manage taxes',
  'inventory.view': 'View inventory',
  'inventory.manage': 'Manage stock, recipes, suppliers and purchases',
  'wastage.record': 'Record wastage and complimentary items',
  'wastage.approve': 'Approve wastage',
  'expenses.manage': 'Manage expenses',
  'payroll.manage': 'Manage payroll',
  'reports.view': 'View reports',
  'reports.financial': 'View financial reports (P&L, ledger)',
  'customers.manage': 'Manage customers',
  'loyalty.manage': 'Manage loyalty and coupons',
  'reservations.manage': 'Manage reservations and waiting list',
  'feedback.manage': 'Manage feedback and complaints',
  'staff.manage': 'Manage employees and roles',
  'branches.manage': 'Manage branches',
  'settings.manage': 'Manage restaurant settings, payment methods and printers',
  'website.manage': 'Manage website and theme',
  'support.handle': 'Handle customer chat and requests',
  'calls.receive': 'Receive customer calls',
  'discrepancy.manage': 'Record and classify billing errors',
  'audit.view': 'View audit log',
  'subscription.manage': 'Manage subscription and agreements',
} as const;

export type Permission = keyof typeof PERMISSIONS;
const all = Object.keys(PERMISSIONS) as Permission[];

export const DEFAULT_ROLES: { key: string; name: string; permissions: (Permission | '*')[] }[] = [
  { key: 'owner', name: 'Restaurant Owner', permissions: ['*'] },
  { key: 'admin', name: 'Administrator', permissions: all.filter((p) => p !== 'subscription.manage') },
  { key: 'manager', name: 'Manager', permissions: ['dashboard.view', 'orders.view', 'orders.create', 'orders.manage', 'kitchen.view', 'kitchen.update', 'waiter.use', 'pos.use', 'pos.refund', 'discounts.apply', 'menu.manage', 'tables.manage', 'billing.view', 'payments.approve', 'inventory.view', 'inventory.manage', 'wastage.record', 'wastage.approve', 'expenses.manage', 'reports.view', 'customers.manage', 'loyalty.manage', 'reservations.manage', 'feedback.manage', 'support.handle', 'calls.receive', 'discrepancy.manage'] },
  { key: 'assistant_manager', name: 'Assistant Manager', permissions: ['dashboard.view', 'orders.view', 'orders.create', 'orders.manage', 'kitchen.view', 'waiter.use', 'pos.use', 'discounts.apply', 'billing.view', 'payments.approve', 'inventory.view', 'wastage.record', 'reports.view', 'customers.manage', 'reservations.manage', 'feedback.manage', 'support.handle', 'calls.receive'] },
  { key: 'cashier', name: 'Cashier', permissions: ['orders.view', 'orders.create', 'pos.use', 'billing.view', 'payments.approve', 'customers.manage', 'support.handle'] },
  { key: 'waiter', name: 'Waiter', permissions: ['orders.view', 'orders.create', 'waiter.use', 'support.handle', 'calls.receive'] },
  { key: 'kitchen', name: 'Kitchen Staff', permissions: ['kitchen.view', 'kitchen.update', 'wastage.record'] },
  { key: 'inventory', name: 'Inventory Manager', permissions: ['inventory.view', 'inventory.manage', 'wastage.record', 'wastage.approve', 'reports.view'] },
  { key: 'accountant', name: 'Accountant', permissions: ['dashboard.view', 'billing.view', 'expenses.manage', 'payroll.manage', 'reports.view', 'reports.financial', 'discrepancy.manage', 'audit.view'] },
];

export function hasPermission(perms: string[], p: Permission) {
  return perms.includes('*') || perms.includes(p);
}
