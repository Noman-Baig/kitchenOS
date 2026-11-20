import Link from 'next/link';
import { getBranding } from '@/lib/branding';
import { FEATURES } from '@/content/marketing';
import { ThemeToggle } from './Providers';

export async function SiteHeader() {
  const b = await getBranding();
  return (
    <header className="site-header">
      <div className="container inner">
        <Link href="/" className="row" style={{ gap: 10, fontWeight: 700 }} aria-label={`${b.softwareName} home`}>
          <span className="brand-logo">{b.logoUrl ? <img src={b.logoUrl} alt="" width={28} height={28} /> : b.softwareName.slice(0, 1).toUpperCase()}</span>
          <span>{b.softwareName}</span>
        </Link>
        <nav className="site-nav" aria-label="Main">
          <Link href="/features/restaurant-management-software">Product</Link>
          <Link href="/features/restaurant-pos-software">POS</Link>
          <Link href="/features/qr-code-ordering-system">QR ordering</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/faq">FAQ</Link>
          <Link href="/help">Help</Link>
        </nav>
        <div className="row" style={{ gap: 8 }}>
          <ThemeToggle />
          <Link href="/login" className="btn btn-ghost">Sign in</Link>
          <Link href="/register" className="btn btn-primary">Get started</Link>
        </div>
      </div>
    </header>
  );
}

export async function SiteFooter() {
  const b = await getBranding();
  const year = new Date().getFullYear();
  return (
    <footer className="site-footer">
      <div className="container grid grid-4">
        <div className="stack" style={{ gap: 8 }}>
          <strong style={{ color: 'var(--text)' }}>{b.softwareName}</strong>
          <span>{b.footerText}</span>
          {b.supportEmail && <a href={`mailto:${b.supportEmail}`}>{b.supportEmail}</a>}
          {b.supportPhone && <span>{b.supportPhone}</span>}
          {b.businessAddress && <span>{b.businessAddress}</span>}
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <strong style={{ color: 'var(--text)' }}>Product</strong>
          {FEATURES.slice(0, 5).map((f) => <Link key={f.slug} href={`/features/${f.slug}`}>{f.nav}</Link>)}
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <strong style={{ color: 'var(--text)' }}>More</strong>
          {FEATURES.slice(5).map((f) => <Link key={f.slug} href={`/features/${f.slug}`}>{f.nav}</Link>)}
        </div>
        <div className="stack" style={{ gap: 6 }}>
          <strong style={{ color: 'var(--text)' }}>Company</strong>
          <Link href="/pricing">Pricing</Link><Link href="/contact">Book a demo</Link><Link href="/help">Help centre</Link>
          <Link href={b.termsUrl || '/terms'}>Terms of Service</Link><Link href={b.privacyUrl || '/privacy'}>Privacy Policy</Link>
        </div>
      </div>
      <div className="container small mt" style={{ paddingTop: 20, borderTop: '1px solid var(--border)' }}>{b.copyright || `© ${year} ${b.softwareName}. All rights reserved.`}</div>
    </footer>
  );
}

export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />;
}
