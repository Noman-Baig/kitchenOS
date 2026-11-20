import Link from 'next/link';
import type { Metadata } from 'next';
import { ArrowRight, Check, ShieldCheck, Globe2, Zap } from 'lucide-react';
import { getBranding, serverGet, siteUrl } from '@/lib/branding';
import { FEATURES, FAQS } from '@/content/marketing';
import { FeatureIcon } from '@/components/Icon';
import { JsonLd } from '@/components/Site';
import { ProductPreview } from '@/components/ProductPreview';

export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const b = await getBranding();
  return {
    title: { absolute: `${b.softwareName} — Restaurant Operating System: QR Ordering, POS, Kitchen & Inventory` },
    description: 'Run your restaurant on one system: QR table ordering, online ordering, POS, kitchen display, inventory and recipe costing, billing with separate taxes, staff, payroll and reporting.',
    alternates: { canonical: '/' },
    openGraph: { title: `${b.softwareName} — Restaurant Operating System`, url: '/' },
  };
}

export default async function Home() {
  const b = await getBranding();
  const plans = (await serverGet<any[]>('/public/plans', 300)) || [];
  const url = siteUrl();
  return (
    <>
      <JsonLd data={{ '@context': 'https://schema.org', '@type': 'Organization', name: b.softwareName, url, email: b.supportEmail || undefined, telephone: b.supportPhone || undefined, logo: b.logoUrl ? `${url}${b.logoUrl}` : undefined }} />
      <JsonLd data={{ '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: b.softwareName, applicationCategory: 'BusinessApplication', operatingSystem: 'Web browser', offers: plans.length ? plans.map((p) => ({ '@type': 'Offer', name: p.name, price: Number(p.price).toFixed(2), priceCurrency: p.currency })) : undefined }} />
      <JsonLd data={{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQS.slice(0, 6).map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }} />

      <section className="hero">
        <div className="container grid" style={{ gridTemplateColumns: 'minmax(0,1.05fr) minmax(0,1fr)', alignItems: 'center', gap: 48 }}>
          <div>
            <span className="eyebrow">Restaurant operating system</span>
            <h1>Every order, every table, every number — in one place.</h1>
            <p className="lead">QR table ordering, online ordering, POS, kitchen display, inventory, billing and reporting that share one live database. Fewer handoffs, fewer mistakes, profit you can trust.</p>
            <div className="row">
              <Link href="/register" className="btn btn-primary btn-lg">Start your restaurant <ArrowRight size={17} /></Link>
              <Link href="/contact" className="btn btn-lg">Book a demo</Link>
            </div>
            <div className="row small muted mt" style={{ gap: 18 }}>
              <span className="row" style={{ gap: 6 }}><Check size={15} /> No app for guests</span>
              <span className="row" style={{ gap: 6 }}><Check size={15} /> No per-order commission</span>
              <span className="row" style={{ gap: 6 }}><Check size={15} /> Any currency & tax</span>
            </div>
          </div>
          <ProductPreview />
        </div>
      </section>

      <section className="section section-alt" id="features">
        <div className="container">
          <h2>Built for the whole restaurant, not just the menu</h2>
          <p className="muted" style={{ maxWidth: 640 }}>Each module works on its own, and together they remove the re-typing between front of house, kitchen and office.</p>
          <div className="grid grid-3 mt">
            {FEATURES.map((f) => (
              <Link key={f.slug} href={`/features/${f.slug}`} className="feature">
                <div className="ico"><FeatureIcon name={f.icon} /></div>
                <h3>{f.title}</h3><p>{f.description}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container grid grid-2" style={{ gap: 48, alignItems: 'start' }}>
          <div>
            <h2>The guest journey</h2>
            <ol className="stack" style={{ paddingLeft: 18, marginTop: 16 }}>
              <li><strong>Scan.</strong> The table QR opens your menu — no download, no account.</li>
              <li><strong>Order.</strong> Variants, add-ons, notes and live availability. Edit within the window you allow.</li>
              <li><strong>Track.</strong> Accepted, preparing, ready — with a realistic preparation estimate.</li>
              <li><strong>Ask.</strong> Call a waiter, chat, or start an in-browser voice call at any time.</li>
              <li><strong>Pay.</strong> See every tax separately, upload a transfer screenshot or request cash.</li>
              <li><strong>Return.</strong> Scan again later and the same table session and bill come back.</li>
            </ol>
          </div>
          <div>
            <h2>The restaurant journey</h2>
            <ol className="stack" style={{ paddingLeft: 18, marginTop: 16 }}>
              <li><strong>Accept.</strong> New orders arrive instantly on the dashboard, POS and waiter phones.</li>
              <li><strong>Cook.</strong> Items route to pizza, grill, drinks or dessert stations with timers.</li>
              <li><strong>Serve.</strong> Waiters see ready orders and table requests in real time.</li>
              <li><strong>Settle.</strong> Approve payments, split bills, take cash, print receipts.</li>
              <li><strong>Count.</strong> Stock is deducted from recipes; wastage and comps are tracked.</li>
              <li><strong>Know.</strong> Sales, taxes, food cost and profit reconcile with the ledger.</li>
            </ol>
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="container">
          <h2>Who it is for</h2>
          <div className="grid grid-4 mt">
            {[['Cafés & quick service', 'Counter POS, takeaway, online pickup and loyalty for regulars.'], ['Casual & fine dining', 'Table QR, waiter app, reservations, kitchen stations and split bills.'], ['Cloud kitchens', 'Online storefront, delivery charges, scheduled orders and food-cost control.'], ['Groups & franchises', 'Branches, consolidated reports, stock transfers and central menus.']].map(([h, p]) => (
              <div key={h} className="feature"><h3>{h}</h3><p>{p}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container grid grid-3">
          <div className="feature"><div className="ico"><ShieldCheck size={18} /></div><h3>Secure by default</h3><p>Strict tenant isolation, Argon2id passwords, HttpOnly sessions, CSRF protection, signed file links, audit logs and verified backups.</p></div>
          <div className="feature"><div className="ico"><Globe2 size={18} /></div><h3>Global from day one</h3><p>Any ISO currency with correct decimals, your timezone, localised formatting and fully configurable taxes.</p></div>
          <div className="feature"><div className="ico"><Zap size={18} /></div><h3>Real-time and fast</h3><p>WebSocket updates for orders, kitchen and chat with automatic reconnect and resync — no page refreshing.</p></div>
        </div>
      </section>

      {plans.length > 0 && (
        <section className="section section-alt" id="pricing">
          <div className="container">
            <h2>Simple monthly plans</h2>
            <div className="grid grid-3 mt">
              {plans.map((p, i) => (
                <div key={p.id} className={`price-card ${i === 1 ? 'featured' : ''}`}>
                  <strong>{p.name}</strong>
                  <div className="price">{new Intl.NumberFormat('en', { style: 'currency', currency: p.currency, maximumFractionDigits: 0 }).format(Number(p.price))}<span className="small muted"> / {p.duration_days === 30 ? 'month' : `${p.duration_days} days`}</span></div>
                  <p className="muted small">{p.description}</p>
                  <ul>{(typeof p.features === 'string' ? JSON.parse(p.features) : p.features || []).map((f: string) => <li key={f} className="row" style={{ gap: 8 }}><Check size={15} color="var(--brand)" /> {f}</li>)}</ul>
                  <Link href="/register" className={`btn ${i === 1 ? 'btn-primary' : ''} btn-block mt`}>Choose {p.name}</Link>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="section">
        <div className="container grid grid-2" style={{ gap: 48 }}>
          <div><h2>Questions, answered</h2><p className="muted">More in the <Link className="link" href="/faq">full FAQ</Link> and the <Link className="link" href="/help">help centre</Link>.</p></div>
          <div className="faq">{FAQS.slice(0, 6).map((f) => <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>)}</div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="container row-between">
          <div><h2 style={{ margin: 0 }}>Ready to run a calmer service?</h2><p className="muted" style={{ margin: '6px 0 0' }}>Register in minutes. Our team reviews and activates your account.</p></div>
          <div className="row"><Link href="/register" className="btn btn-primary btn-lg">Get started</Link><Link href="/contact" className="btn btn-lg">Talk to us</Link></div>
        </div>
      </section>
    </>
  );
}
