import Link from 'next/link';

export default function NotFound() {
  return (
    <main style={{ minHeight: '70vh', display: 'grid', placeItems: 'center', padding: 16, textAlign: 'center' }}>
      <div><h1 style={{ fontSize: '3rem', margin: 0 }}>404</h1><p className="muted">This page could not be found. If you scanned a QR code, it may have been replaced — please ask staff for help.</p><Link className="btn" href="/">Go home</Link></div>
    </main>
  );
}
