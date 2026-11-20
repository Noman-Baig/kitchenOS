import type { Metadata } from 'next';
import { FAQS } from '@/content/marketing';
import { JsonLd } from '@/components/Site';

export const metadata: Metadata = { title: 'Frequently asked questions', description: 'Answers about pricing, subscriptions, QR ordering, POS, inventory, payments, printers, multi-branch, security, data export and international use.', alternates: { canonical: '/faq' } };

export default function Faq() {
  const groups = [...new Set(FAQS.map((f) => f.group))];
  return (
    <section className="section">
      <JsonLd data={{ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQS.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) }} />
      <div className="container" style={{ maxWidth: 860 }}>
        <h1 style={{ fontSize: '2.2rem' }}>Frequently asked questions</h1>
        {groups.map((g) => (
          <div key={g} className="faq mt">
            <h2 className="section-title">{g}</h2>
            {FAQS.filter((f) => f.group === g).map((f) => <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>)}
          </div>
        ))}
      </div>
    </section>
  );
}
