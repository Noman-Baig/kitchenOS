import Link from 'next/link';
import type { Metadata } from 'next';
import { Check } from 'lucide-react';
import { serverGet } from '@/lib/branding';
import { FAQS } from '@/content/marketing';

export const revalidate = 300;
export const metadata: Metadata = { title: 'Pricing', description: 'Monthly restaurant software plans with QR ordering, POS, kitchen display, inventory and reporting. No per-order commissions.', alternates: { canonical: '/pricing' } };

export default async function Pricing() {
  const plans = (await serverGet<any[]>('/public/plans', 300)) || [];
  return (
    <section className="section">
      <div className="container">
        <h1 style={{ fontSize: '2.2rem' }}>Pricing</h1>
        <p className="muted" style={{ maxWidth: 620 }}>One monthly subscription per restaurant. No setup fees, no per-order commissions. Pay by bank transfer or the methods listed in your dashboard; your plan activates once payment is verified.</p>
        {plans.length === 0 ? <div className="alert mt">Plans are being configured. <Link className="link" href="/contact">Contact us</Link> for a quote.</div> : (
          <div className="grid grid-3 mt">
            {plans.map((p, i) => (
              <div key={p.id} className={`price-card ${i === 1 ? 'featured' : ''}`}>
                <strong>{p.name}</strong>
                <div className="price">{new Intl.NumberFormat('en', { style: 'currency', currency: p.currency }).format(Number(p.price))}<span className="small muted"> / {p.duration_days} days</span></div>
                <p className="muted small">{p.description}</p>
                <div className="small muted">Up to {p.max_branches} branch{p.max_branches > 1 ? 'es' : ''}</div>
                <ul>{(typeof p.features === 'string' ? JSON.parse(p.features) : p.features || []).map((f: string) => <li key={f} className="row" style={{ gap: 8 }}><Check size={15} color="var(--brand)" /> {f}</li>)}</ul>
                <Link href="/register" className={`btn ${i === 1 ? 'btn-primary' : ''} btn-block mt`}>Choose {p.name}</Link>
              </div>
            ))}
          </div>
        )}
        <div className="faq mt" style={{ maxWidth: 760 }}>
          <h2 className="mt">Billing questions</h2>
          {FAQS.filter((f) => ['Pricing', 'Subscriptions', 'Payments'].includes(f.group)).map((f) => <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>)}
        </div>
      </div>
    </section>
  );
}
