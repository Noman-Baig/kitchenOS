import type { Metadata } from 'next';
import Link from 'next/link';
import { getBranding } from '@/lib/branding';

export const metadata: Metadata = { title: 'Terms of Service', description: 'Terms that apply to restaurants, staff and guests using the platform.', alternates: { canonical: '/terms' } };
export const revalidate = 3600;

export default async function Terms() {
  const b = await getBranding();
  const n = b.softwareName;
  return (
    <section className="section"><div className="container"><article className="prose">
      <h1>Terms of Service</h1>
      <p className="muted">Last updated: {new Date().toISOString().slice(0, 10)}</p>
      <p>These Terms govern use of {n} (the “Service”). Restaurants additionally accept the Platform Subscription and Services Agreement during registration; if the two conflict, that Agreement prevails for restaurants.</p>

      <h2>1. Who can use the Service</h2>
      <p><strong>Restaurants</strong> register an account, which is reviewed before activation. <strong>Staff</strong> use accounts created by their restaurant. <strong>Guests</strong> can order without an account at restaurants that use the Service.</p>

      <h2>2. Accounts and security</h2>
      <ul><li>Keep your password confidential and do not share accounts.</li><li>Restaurants are responsible for the permissions they give staff and for disabling accounts of staff who leave.</li><li>Tell us promptly at {b.supportEmail} if you suspect unauthorised access.</li></ul>

      <h2>3. Subscriptions</h2>
      <ul><li>Plans are billed for the period shown at purchase. A subscription is activated or renewed only after the payment has been verified by us.</li><li>After expiry a grace period applies; afterwards the dashboard, ordering pages, table QR codes, online ordering and POS are paused until renewal.</li><li>Data of suspended or expired accounts is retained for the retention period shown in the account (three months by default) and may then be deleted permanently. You can export your data before then.</li><li>Fees are non-refundable unless required by law or agreed in writing.</li></ul>

      <h2>4. Restaurant responsibilities</h2>
      <ul><li>Accuracy of menus, prices, allergen and ingredient information.</li><li>Correct configuration of taxes, receipts and invoices for your jurisdiction, and filing your own tax returns.</li><li>Verifying guest payments before approving them. The Service records payments; it does not process or guarantee them.</li><li>Obtaining consent before marketing to guests and honouring opt-outs.</li><li>Compliance with food safety, consumer protection, employment and other laws.</li></ul>

      <h2>5. Guest orders</h2>
      <p>Orders placed through a restaurant’s QR code or storefront are contracts between the guest and the restaurant. Preparation times shown are estimates. Questions about orders, payments, refunds or allergens should be directed to the restaurant, which can be contacted through the in-app chat, waiter call or the contact details shown.</p>

      <h2>6. Acceptable use</h2>
      <p>You must not misuse the Service, including: attempting to access data of other restaurants or guests, probing or bypassing security, uploading malware or unlawful content, submitting fake payment proofs, overloading the Service, or using it for unlawful purposes.</p>

      <h2>7. Content and data</h2>
      <p>Restaurants retain ownership of their content and data and grant us the rights needed to host and display it to provide the Service. Our handling of personal data is described in the <Link href="/privacy">Privacy Policy</Link>.</p>

      <h2>8. Availability and changes</h2>
      <p>We work to keep the Service available and secure but do not guarantee uninterrupted operation. Features may change; we will give reasonable notice of material reductions where possible.</p>

      <h2>9. Third-party hardware and browsers</h2>
      <p>Printing, voice calls and Bluetooth/USB features depend on your devices, browsers and network. See the help centre for supported configurations.</p>

      <h2>10. Liability</h2>
      <p>To the extent permitted by law, we are not liable for indirect or consequential losses, lost profits or lost data, and our total liability in any 12-month period is limited to the fees paid to us for the Service in that period. Nothing limits liability that cannot be limited by law.</p>

      <h2>11. Suspension and termination</h2>
      <p>We may suspend accounts for non-payment or breach of these Terms. Restaurants may close their account at any time; data retention then follows section 3.</p>

      <h2>12. Governing law</h2>
      <p>These Terms are governed by the laws of the jurisdiction where the platform operator is established, unless mandatory local law provides otherwise.</p>

      <h2>13. Contact</h2>
      <p>{b.supportEmail}{b.supportPhone ? ` · ${b.supportPhone}` : ''}{b.businessAddress ? ` · ${b.businessAddress}` : ''}</p>
      <p className="small muted">These terms are a general template provided with the software. The operator should obtain jurisdiction-specific legal review before relying on them.</p>
    </article></div></section>
  );
}
