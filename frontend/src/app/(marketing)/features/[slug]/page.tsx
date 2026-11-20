import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Check } from 'lucide-react';
import { FEATURES } from '@/content/marketing';
import { getBranding, siteUrl } from '@/lib/branding';
import { JsonLd } from '@/components/Site';
import { FeatureIcon } from '@/components/Icon';

export const revalidate = 3600;
export function generateStaticParams() { return FEATURES.map((f) => ({ slug: f.slug })); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const f = FEATURES.find((x) => x.slug === slug);
  if (!f) return {};
  const b = await getBranding();
  return { title: f.title, description: f.description, alternates: { canonical: `/features/${f.slug}` }, openGraph: { title: `${f.title} | ${b.softwareName}`, description: f.description, url: `/features/${f.slug}` } };
}

export default async function FeaturePageView({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const f = FEATURES.find((x) => x.slug === slug);
  if (!f) notFound();
  const url = siteUrl();
  const related = FEATURES.filter((x) => x.slug !== f.slug).slice(0, 3);
  return (
    <>
      <JsonLd data={{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: url }, { '@type': 'ListItem', position: 2, name: 'Features', item: `${url}/#features` }, { '@type': 'ListItem', position: 3, name: f.title, item: `${url}/features/${f.slug}` }] }} />
      {f.faqs.length > 0 && <JsonLd data={{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: f.faqs.map((q) => ({ '@type': 'Question', name: q.q, acceptedAnswer: { '@type': 'Answer', text: q.a } })) }} />}
      <section className="hero" style={{ paddingBottom: 30 }}>
        <div className="container">
          <nav className="breadcrumbs" aria-label="Breadcrumb"><Link href="/">Home</Link><span>/</span><Link href="/#features">Features</Link><span>/</span><span>{f.title}</span></nav>
          <span className="eyebrow"><FeatureIcon name={f.icon} size={14} /> {f.title}</span>
          <h1>{f.h1}</h1>
          <p className="lead">{f.intro}</p>
          <div className="row"><Link href="/register" className="btn btn-primary btn-lg">Get started</Link><Link href="/contact" className="btn btn-lg">Book a demo</Link></div>
        </div>
      </section>
      <section className="section section-alt">
        <div className="container grid grid-2">
          {f.points.map((p) => <article key={p.h} className="feature"><h2 style={{ fontSize: '1.05rem' }}>{p.h}</h2><p>{p.p}</p></article>)}
        </div>
      </section>
      <section className="section">
        <div className="container grid grid-2" style={{ gap: 48 }}>
          <div>
            <h2>How it works</h2>
            <ol className="stack" style={{ paddingLeft: 18 }}>{f.workflow.map((w) => <li key={w}>{w}</li>)}</ol>
          </div>
          <div>
            <h2>Part of one platform</h2>
            <ul className="stack" style={{ listStyle: 'none', padding: 0 }}>
              {['Same menu, prices and taxes everywhere', 'Same stock and recipes', 'Same ledger and reports', 'Same staff roles and audit log'].map((x) => <li key={x} className="row" style={{ gap: 8 }}><Check size={16} color="var(--brand)" /> {x}</li>)}
            </ul>
            {f.faqs.length > 0 && <div className="faq mt">{f.faqs.map((q) => <details key={q.q}><summary>{q.q}</summary><p>{q.a}</p></details>)}</div>}
          </div>
        </div>
      </section>
      <section className="section section-alt">
        <div className="container">
          <h2>Related</h2>
          <div className="grid grid-3 mt">{related.map((r) => <Link key={r.slug} href={`/features/${r.slug}`} className="feature"><div className="ico"><FeatureIcon name={r.icon} /></div><h3>{r.title}</h3><p>{r.description}</p></Link>)}</div>
        </div>
      </section>
    </>
  );
}
