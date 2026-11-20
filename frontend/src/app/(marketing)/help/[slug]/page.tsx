import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GUIDES } from '@/content/help';

export function generateStaticParams() { return GUIDES.map((g) => ({ slug: g.slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const g = GUIDES.find((x) => x.slug === slug);
  return g ? { title: g.title, description: g.summary, alternates: { canonical: `/help/${g.slug}` } } : {};
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const g = GUIDES.find((x) => x.slug === slug);
  if (!g) notFound();
  return (
    <section className="section"><div className="container">
      <nav className="breadcrumbs" aria-label="Breadcrumb"><Link href="/help">Help centre</Link><span>/</span><span>{g.audience}</span></nav>
      <article className="prose">
        <h1>{g.title}</h1>
        <p className="muted">{g.summary}</p>
        {g.sections.map((s) => (
          <section key={s.h}><h2>{s.h}</h2>{s.p && <p>{s.p}</p>}{s.steps && <ol>{s.steps.map((x) => <li key={x}>{x}</li>)}</ol>}</section>
        ))}
        <hr /><p className="small muted">Other guides: {GUIDES.filter((x) => x.slug !== g.slug).map((x, i) => <span key={x.slug}>{i ? ' · ' : ''}<Link href={`/help/${x.slug}`}>{x.title}</Link></span>)}</p>
      </article>
    </div></section>
  );
}
