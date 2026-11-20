'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Moon, Sun } from 'lucide-react';
import { ToastProvider } from './ui';

export type BrandingClient = { softwareName: string; logoUrl: string | null; primaryColor: string; supportEmail: string; supportPhone: string; footerText: string; copyright: string; termsUrl: string; privacyUrl: string };
const BrandCtx = createContext<BrandingClient>({ softwareName: 'umemaai_undated_version', logoUrl: null, primaryColor: '#0F766E', supportEmail: '', supportPhone: '', footerText: '', copyright: '', termsUrl: '/terms', privacyUrl: '/privacy' });
export const useBranding = () => useContext(BrandCtx);

export function Providers({ branding, children }: { branding: BrandingClient; children: ReactNode }) {
  return <BrandCtx.Provider value={branding}><ToastProvider>{children}</ToastProvider></BrandCtx.Provider>;
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  useEffect(() => { setTheme((document.documentElement.dataset.theme as any) || 'light'); }, []);
  const toggle = () => {
    const t = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('um_theme', t); } catch { /* private mode */ }
    setTheme(t);
  };
  return <button className="btn btn-ghost icon-btn" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>{theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}</button>;
}

export function BrandMark({ size = 28 }: { size?: number }) {
  const b = useBranding();
  return <span className="brand-logo" style={{ width: size, height: size }}>{b.logoUrl ? <img src={b.logoUrl} alt="" width={size} height={size} /> : b.softwareName.slice(0, 1).toUpperCase()}</span>;
}
