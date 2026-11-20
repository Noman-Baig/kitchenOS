'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { useBranding } from '@/components/Providers';

export default function Suspended() {
  const b = useBranding();
  const [info, setInfo] = useState<any>(null);
  useEffect(() => {
    try { setInfo(JSON.parse(sessionStorage.getItem('um_suspension') || 'null')); } catch { /* ignore */ }
    api('/auth/me').then((m) => { if (m.restaurant?.suspension) setInfo(m.restaurant.suspension); }).catch(() => undefined);
  }, []);
  const state = info?.state;
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div className="card stack" style={{ maxWidth: 560, padding: 28 }}>
        <AlertTriangle size={30} color="var(--warning)" />
        <h1>{state === 'pending' ? 'Account awaiting approval' : state === 'expired' ? 'Subscription expired' : 'Account suspended'}</h1>
        {info?.restaurantName && <p className="muted" style={{ margin: 0 }}>{info.restaurantName}</p>}
        <p><strong>Reason:</strong> {info?.reason || 'This restaurant account is not active.'}</p>
        {info?.deletionWarning && <div className="alert alert-danger">{info.deletionWarning}{info.deletionScheduledAt ? ` (scheduled: ${new Date(info.deletionScheduledAt).toLocaleDateString()})` : ''}</div>}
        {info?.renewalInstructions && <div className="alert"><strong>How to renew</strong><p style={{ margin: '6px 0 0' }}>{info.renewalInstructions}</p></div>}
        <div className="stack" style={{ gap: 4 }}>
          <div className="small muted">Support</div>
          <a className="link" href={`mailto:${info?.supportEmail || b.supportEmail}`}>{info?.supportEmail || b.supportEmail}</a>
          {(info?.supportPhone || b.supportPhone) && <span>{info?.supportPhone || b.supportPhone}</span>}
        </div>
        <div className="row"><Link className="btn btn-primary" href="/dashboard/subscription">Renew / submit payment</Link><Link className="btn" href="/login">Sign in with another account</Link></div>
      </div>
    </main>
  );
}
