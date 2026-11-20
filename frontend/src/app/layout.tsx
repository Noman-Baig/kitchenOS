import type { Metadata, Viewport } from 'next';
import './globals.css';
import { getBranding, siteUrl } from '@/lib/branding';
import { Providers } from '@/components/Providers';

export async function generateMetadata(): Promise<Metadata> {
  const b = await getBranding();
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: `${b.softwareName} — Restaurant Operating System`, template: `%s | ${b.softwareName}` },
    description: 'QR table ordering, online ordering, POS, kitchen display, inventory, recipe costing, billing and reporting in one restaurant operating system.',
    applicationName: b.softwareName,
    icons: b.faviconUrl ? { icon: b.faviconUrl } : undefined,
    openGraph: { siteName: b.softwareName, type: 'website' },
    twitter: { card: 'summary_large_image' },
  };
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: [{ media: '(prefers-color-scheme: light)', color: '#fafaf9' }, { media: '(prefers-color-scheme: dark)', color: '#0c0a09' }] };

const themeScript = `(function(){try{var t=localStorage.getItem('um_theme');if(!t)t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t}catch(e){}})()`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const b = await getBranding();
  const brandClient = { softwareName: b.softwareName, logoUrl: b.logoUrl, primaryColor: b.primaryColor, supportEmail: b.supportEmail, supportPhone: b.supportPhone, footerText: b.footerText, copyright: b.copyright, termsUrl: b.termsUrl, privacyUrl: b.privacyUrl };
  return (
    <html lang="en" suppressHydrationWarning style={{ ['--brand' as any]: b.primaryColor }}>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body><Providers branding={brandClient}>{children}</Providers></body>
    </html>
  );
}
