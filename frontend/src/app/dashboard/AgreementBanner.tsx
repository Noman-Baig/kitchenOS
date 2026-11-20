'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/components/Session';
import { Modal, useAction } from '@/components/ui';
import { SignaturePad } from '@/components/SignaturePad';

/** Shown when a new material agreement version requires re-acceptance; also warns during the grace period. */
export function AgreementBanner() {
  const s = useSession();
  const [open, setOpen] = useState(false);
  const [doc, setDoc] = useState<any>(null);
  const [name, setName] = useState(s.user.name);
  const [title, setTitle] = useState('');
  const [sig, setSig] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [run, busy] = useAction();
  const pa = s.restaurant?.pendingAgreement;
  const grace = s.restaurant?.availability?.state === 'grace';
  if (!pa && !grace) return null;
  return (
    <div className="no-print" style={{ padding: '12px 24px 0' }}>
      {grace && <div className="alert alert-warning mb">Your subscription has expired and you are in the grace period until {new Date(s.restaurant!.availability.graceEndsAt).toLocaleDateString()}. <a className="link" href="/dashboard/subscription">Renew now</a> to avoid interruption.</div>}
      {pa && <div className="alert alert-warning row-between">An updated platform agreement (v{pa.version}) needs your acceptance.
        {s.can('subscription.manage') && <button className="btn btn-sm btn-primary" onClick={async () => { setDoc((await api('/r/agreements')).data.current); setOpen(true); }}>Review & sign</button>}</div>}
      <Modal open={open} title={doc?.title || 'Agreement'} onClose={() => setOpen(false)}>
        <div style={{ maxHeight: 260, overflowY: 'auto', whiteSpace: 'pre-wrap', fontSize: 13, border: '1px solid var(--border)', padding: 12, borderRadius: 8 }}>{doc?.body}</div>
        <div className="form-grid mt"><label className="field">Signer name<input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label><label className="field">Title<input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></label></div>
        <div className="mt"><SignaturePad onChange={setSig} /></div>
        <label className="check mt"><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> I accept this agreement on behalf of the restaurant.</label>
        <div className="row mt" style={{ justifyContent: 'flex-end' }}><button className="btn btn-primary" disabled={!sig || !ok || busy} onClick={async () => { const r = await run(() => api('/r/agreements/accept', { body: { agreementId: doc.id, signerName: name, signerTitle: title || null, signatureDataUrl: sig, accepted: true } }), 'Agreement signed'); if (r) { setOpen(false); s.reload(); } }}>Sign</button></div>
      </Modal>
    </div>
  );
}
