import 'server-only';

export interface Branding {
  softwareName: string; logoUrl: string | null; faviconUrl: string | null; primaryColor: string; secondaryColor: string;
  supportEmail: string; supportPhone: string; businessAddress: string; websiteUrl: string; copyright: string; footerText: string;
  termsUrl: string; privacyUrl: string; emailSenderName: string; emailSenderAddress: string;
}

export const FALLBACK_BRANDING: Branding = {
  softwareName: 'umemaai_undated_version', logoUrl: null, faviconUrl: null, primaryColor: '#0F766E', secondaryColor: '#111827',
  supportEmail: 'support@example.com', supportPhone: '', businessAddress: '', websiteUrl: '', copyright: '',
  footerText: 'Restaurant operating system for dine-in, online ordering, POS and back office.', termsUrl: '/terms', privacyUrl: '/privacy', emailSenderName: '', emailSenderAddress: '',
};

const backend = () => process.env.BACKEND_URL || 'http://192.168.100.198:4000';

/** Centralised branding (Super Admin → Settings). Cached for 60 s and revalidated, so renames propagate everywhere. */
export async function getBranding(): Promise<Branding> {
  try {
    const r = await fetch(`${backend()}/api/v1/public/branding`, { next: { revalidate: 60, tags: ['branding'] } });
    if (!r.ok) return FALLBACK_BRANDING;
    const j = await r.json();
    return { ...FALLBACK_BRANDING, ...j.data };
  } catch { return FALLBACK_BRANDING; }
}

export async function serverGet<T = any>(path: string, revalidate = 60): Promise<T | null> {
  try {
    const r = await fetch(`${backend()}/api/v1${path}`, { next: { revalidate } });
    if (!r.ok) return null;
    return (await r.json()).data as T;
  } catch { return null; }
}

export const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL || process.env.APP_URL || 'http://192.168.100.198:3000').replace(/\/$/, '');
