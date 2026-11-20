import { exec, j, one, q, toJson, type Db, pool } from '../lib/db.js';

export interface Branding {
  softwareName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  supportEmail: string;
  supportPhone: string;
  businessAddress: string;
  websiteUrl: string;
  copyright: string;
  footerText: string;
  termsUrl: string;
  privacyUrl: string;
  emailSenderName: string;
  emailSenderAddress: string;
}

export const DEFAULT_BRANDING: Branding = {
  softwareName: 'umemaai_undated_version',
  logoUrl: null,
  faviconUrl: null,
  primaryColor: '#0F766E',
  secondaryColor: '#111827',
  supportEmail: 'support@example.com',
  supportPhone: '',
  businessAddress: '',
  websiteUrl: '',
  copyright: '',
  footerText: 'Restaurant operating system for dine-in, online ordering, POS and back office.',
  termsUrl: '/terms',
  privacyUrl: '/privacy',
  emailSenderName: 'umemaai_undated_version',
  emailSenderAddress: '',
};

export interface SubscriptionConfig {
  defaultGraceDays: number;
  reminderDaysBefore: number[];
  dataRetentionDays: number;
  autoDeleteAfterRetention: boolean;
  paymentInstructions: string;
  bankAccounts: { bankName: string; accountTitle: string; accountNumber: string; iban?: string; currency?: string; instructions?: string }[];
  paymentMethods: string[];
  trialDays: number;
}

export const DEFAULT_SUBSCRIPTION: SubscriptionConfig = {
  defaultGraceDays: 7,
  reminderDaysBefore: [7, 3, 1],
  dataRetentionDays: 90,
  autoDeleteAfterRetention: false,
  paymentInstructions: 'Transfer the monthly subscription amount to one of the accounts below, then upload the payment screenshot. Your subscription is activated once the payment has been verified.',
  bankAccounts: [],
  paymentMethods: ['Bank transfer', 'Mobile wallet'],
  trialDays: 0,
};

export const DEFAULT_AUTOMATIONS = {
  subscriptionSweep: true,
  expiryReminders: true,
  recurringExpenses: true,
  payrollGeneration: true,
  reservationReminders: true,
  customerSessionExpiry: true,
  tempCleanup: true,
  databaseBackup: true,
  storageBackup: true,
  scheduledDeletion: true,
  lowStockAlerts: true,
};
export type Automations = typeof DEFAULT_AUTOMATIONS;

let brandingCache: { value: Branding; at: number } | null = null;
const TTL = 30_000;

export async function getSetting<T>(key: string, fallback: T, db: Db = pool): Promise<T> {
  const row = await one<{ setting_value: unknown }>('SELECT setting_value FROM platform_settings WHERE setting_key=?', [key], db);
  if (!row) return fallback;
  const v = j<any>(row.setting_value, fallback);
  return (typeof fallback === 'object' && fallback && !Array.isArray(fallback)) ? { ...fallback, ...v } : v;
}

export async function setSetting(key: string, value: unknown, db: Db = pool) {
  await exec('INSERT INTO platform_settings (setting_key, setting_value) VALUES (?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)', [key, toJson(value)], db);
  if (key === 'branding') brandingCache = null;
}

export async function getBranding(): Promise<Branding> {
  if (brandingCache && Date.now() - brandingCache.at < TTL) return brandingCache.value;
  const value = await getSetting<Branding>('branding', DEFAULT_BRANDING);
  brandingCache = { value, at: Date.now() };
  return value;
}
export function invalidateBranding() { brandingCache = null; }

export const getSubscriptionConfig = () => getSetting<SubscriptionConfig>('subscription', DEFAULT_SUBSCRIPTION);
export const getAutomations = () => getSetting<Automations>('automations', DEFAULT_AUTOMATIONS);

/** Restaurant-level operational settings (stored in restaurants.settings JSON). */
export const DEFAULT_RESTAURANT_SETTINGS = {
  orderApprovalRequired: true,
  editWindowMinutes: 3,          // 0 disables customer editing
  allowMultipleSessionsPerTable: false,
  stockDeductionTrigger: 'accepted' as 'submitted' | 'accepted' | 'ready' | 'completed',
  onlineOrderingOpen: true,
  dineInOpen: true,
  deliveryEnabled: true,
  pickupEnabled: true,
  scheduledOrdersEnabled: false,
  cashOnDeliveryEnabled: true,
  deliveryCharge: '0',
  minimumOrderAmount: '0',
  openingHours: [] as { day: number; open: string; close: string }[],
  returningCustomerGreeting: true,
  loyalty: { enabled: false, pointsPerCurrencyUnit: '1', redeemValuePerPoint: '0.01', minRedeemPoints: 100 },
  reservationSeatingBufferMinutes: 15,
  callReceiverUserIds: [] as number[],
  callReceiverRoleKeys: ['manager', 'waiter', 'owner', 'admin'] as string[],
  fallbackPhone: '',
  kdsSound: true,
  kdsDelayMinutes: 20,
  receiptFooter: 'Thank you for dining with us!',
  sessionIdleHours: 6,
};
export type RestaurantSettings = typeof DEFAULT_RESTAURANT_SETTINGS;

export function restaurantSettings(row: { settings: unknown }): RestaurantSettings {
  const s = j<Partial<RestaurantSettings>>(row.settings, {});
  return { ...DEFAULT_RESTAURANT_SETTINGS, ...s, loyalty: { ...DEFAULT_RESTAURANT_SETTINGS.loyalty, ...(s.loyalty || {}) } };
}

export async function listPlans(activeOnly = true) {
  return q(`SELECT * FROM subscription_plans ${activeOnly ? 'WHERE active=1' : ''} ORDER BY sort_order, price`);
}
