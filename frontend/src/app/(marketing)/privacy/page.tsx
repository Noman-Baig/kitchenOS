import type { Metadata } from 'next';
import { getBranding } from '@/lib/branding';

export const metadata: Metadata = { title: 'Privacy Policy', description: 'How personal data is collected, used, shared, protected and retained on the platform.', alternates: { canonical: '/privacy' } };
export const revalidate = 3600;

export default async function Privacy() {
  const b = await getBranding();
  const n = b.softwareName;
  return (
    <section className="section"><div className="container"><article className="prose">
      <h1>Privacy Policy</h1>
      <p className="muted">Last updated: {new Date().toISOString().slice(0, 10)}</p>
      <p>This Privacy Policy explains how {n} (“we”, “us”) handles personal data when you visit our website, register a restaurant, work as restaurant staff on the platform, or order as a guest at a restaurant that uses {n}.</p>

      <h2>1. Who is responsible</h2>
      <p><strong>Restaurants</strong> decide why and how their guests’ and employees’ data is used. For that data, each restaurant is the controller and we act as its processor (service provider). <strong>We</strong> are the controller for data about restaurant account holders, platform billing, website visitors and demo requests.</p>

      <h2>2. Data we process</h2>
      <h3>Restaurant accounts and staff</h3>
      <ul><li>Business details: name, address, country, timezone, currency, tax settings, contact email and phone.</li><li>Account holder and staff: name, email, phone, role, branch, salary and payroll records if the restaurant uses payroll, login timestamps and IP addresses.</li><li>Agreement acceptance: signer name, title, email, signature image, time, IP address, browser information and a cryptographic hash of the accepted text.</li><li>Subscription payments: plan, amount, reference and the payment screenshot you upload.</li></ul>
      <h3>Guests of restaurants</h3>
      <ul><li>Name you enter, and optionally your phone number.</li><li>Orders, items, notes, bills, taxes, payments and payment screenshots you upload.</li><li>Chat messages, assistance requests, call records (time and outcome — call audio is <strong>not</strong> recorded), feedback and reservations.</li><li>Delivery address and instructions for delivery orders.</li><li>Loyalty points and visit history, and whether you opted in to being recognised or to receive marketing.</li></ul>
      <h3>Website visitors</h3>
      <ul><li>Demo request details you submit.</li><li>Technical logs (IP address, browser, pages requested) kept for security and troubleshooting.</li></ul>

      <h2>3. Why we use it</h2>
      <ul><li>To provide the service: take and route orders, prepare bills, record payments, manage stock and produce reports (performance of a contract).</li><li>To secure the platform: authentication, fraud and abuse prevention, rate limiting, audit logs (legitimate interests).</li><li>To bill restaurants and keep financial records (legal obligation and contract).</li><li>To recognise returning guests and send marketing <strong>only if the guest opted in</strong> (consent, which can be withdrawn at any time).</li></ul>

      <h2>4. Cookies and local storage</h2>
      <p>We use strictly necessary cookies: a secure, HttpOnly session cookie for signed-in staff, a CSRF-protection cookie, and an HttpOnly cookie that lets guests recover their table session after closing the browser. A small preference (light/dark theme) and a copy of the guest session token may be stored in your browser’s local storage. We do not use advertising cookies or third-party trackers.</p>

      <h2>5. Sharing</h2>
      <p>Guest data is shared with the restaurant you order from. We do not sell personal data. We use infrastructure providers (hosting, email delivery, TURN/media relay if enabled) under contracts that require confidentiality and security. We may disclose data where required by law.</p>

      <h2>6. Security</h2>
      <p>Each restaurant’s data is logically isolated and every request is authorised on the server. Passwords are hashed with Argon2id. Connections are encrypted with HTTPS. Payment screenshots, signatures and exports are private and only accessible to authorised staff or via short-lived signed links. Administrative actions are recorded in audit logs and backups are verified.</p>

      <h2>7. Retention</h2>
      <ul><li>Active restaurant accounts: for as long as the account exists.</li><li>Suspended or expired accounts: kept for the configured retention period (three months by default) and then permanently deleted after a final export, unless the account is reactivated.</li><li>Financial records may be kept longer where tax or accounting law requires.</li><li>Guest table sessions expire automatically; guests can ask the restaurant to delete or anonymise their profile.</li></ul>

      <h2>8. Your rights</h2>
      <p>Depending on where you live, you may have the right to access, correct, delete, restrict or object to processing of your data, to data portability, and to withdraw consent. Guests should contact the restaurant first (it controls your data); restaurants can export data and anonymise guest profiles from their dashboard. You can also contact us at {b.supportEmail ? <a href={`mailto:${b.supportEmail}`}>{b.supportEmail}</a> : 'our support address'}. You may complain to your local data protection authority.</p>

      <h2>9. International transfers</h2>
      <p>The service may be hosted in a country different from yours. Where required, we use appropriate safeguards for international transfers.</p>

      <h2>10. Children</h2>
      <p>The platform is not directed to children. Restaurants must not knowingly collect children’s data for marketing.</p>

      <h2>11. Changes</h2>
      <p>We may update this policy and will post the new version here with a new date. Material changes will be communicated to restaurant account holders.</p>

      <h2>12. Contact</h2>
      <p>{n}{b.businessAddress ? `, ${b.businessAddress}` : ''}. Email: {b.supportEmail}{b.supportPhone ? `, phone: ${b.supportPhone}` : ''}.</p>
      <p className="small muted">This policy is a general template provided with the software. The operator of this platform should have it reviewed by a qualified lawyer for the jurisdictions in which it operates.</p>
    </article></div></section>
  );
}
