import type { Metadata } from 'next';
import { getBranding } from '@/lib/branding';
import { DemoForm } from './DemoForm';

export const metadata: Metadata = { title: 'Contact & demo', description: 'Book a demo of the restaurant operating system or contact our team.', alternates: { canonical: '/contact' } };

export default async function Contact() {
  const b = await getBranding();
  return (
    <section className="section">
      <div className="container grid grid-2" style={{ gap: 48 }}>
        <div>
          <h1 style={{ fontSize: '2.2rem' }}>Talk to us</h1>
          <p className="muted">Tell us about your restaurant and we will walk you through QR ordering, POS, kitchen display, inventory and reports with your own menu.</p>
          <div className="stack mt">
            {b.supportEmail && <div><div className="small muted">Email</div><a className="link" href={`mailto:${b.supportEmail}`}>{b.supportEmail}</a></div>}
            {b.supportPhone && <div><div className="small muted">Phone</div>{b.supportPhone}</div>}
            {b.businessAddress && <div><div className="small muted">Address</div>{b.businessAddress}</div>}
          </div>
        </div>
        <div className="card"><DemoForm /></div>
      </div>
    </section>
  );
}
