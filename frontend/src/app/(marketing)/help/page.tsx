import Link from 'next/link';
import type { Metadata } from 'next';
import { GUIDES } from '@/content/help';

export const metadata: Metadata = { title: 'Help centre', description: 'Guides for guests, restaurant owners, waiters, kitchen staff, cashiers, inventory managers, accountants and platform administrators.', alternates: { canonical: '/help' } };

export default function Help() {
  return (
    <section className="section">
      <div className="container">
        <h1 style={{ fontSize: '2.2rem' }}>Help centre</h1>
        <p className="muted">Step-by-step guides for everyone who uses the platform.</p>
        <div className="grid grid-3 mt">
          {GUIDES.map((g) => (
            <Link key={g.slug} href={`/help/${g.slug}`} className="feature">
              <span className="badge badge-brand">{g.audience}</span>
              <h3 className="mt-s">{g.title}</h3><p>{g.summary}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
