'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { ResourcePage } from '@/components/ResourcePage';
import { Status, useAction } from '@/components/ui';

export default function PaymentMethods() {
  const [run] = useAction();
  const [qrId, setQrId] = useState('');
  return (
    <div className="page">
      <ResourcePage title="Payment methods" subtitle="Shown to guests on the bill. Uploaded screenshots are always reviewed by staff before a bill is marked paid." endpoint="/r/payment-methods" searchable={false}
        toolbar={<label className="btn" style={{ cursor: 'pointer' }}>Upload payment QR image<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); const r = await run(() => api('/r/uploads/payment-qr', { form: fd }), 'Uploaded — paste the ID into “QR image ID”'); if (r) setQrId(String(r.data.id)); }} /></label>}
        fields={[
          { name: 'type', label: 'Type', type: 'select', required: true, options: [{ value: 'bank', label: 'Bank transfer' }, { value: 'wallet', label: 'Mobile wallet' }, { value: 'card', label: 'Card (own terminal)' }, { value: 'cash', label: 'Cash' }, { value: 'other', label: 'Other' }] },
          { name: 'label', label: 'Label shown to guests', required: true }, { name: 'bank_name', label: 'Bank / provider', nullable: true }, { name: 'account_title', label: 'Account title', nullable: true },
          { name: 'account_number', label: 'Account number', nullable: true }, { name: 'iban', label: 'IBAN', nullable: true }, { name: 'currency', label: 'Currency', nullable: true },
          { name: 'fee_percent', label: 'Fee % (recorded as payment fee)', type: 'money' }, { name: 'qr_file_id', label: `QR image ID${qrId ? ` (last upload: ${qrId})` : ''}`, type: 'number', nullable: true },
          { name: 'sort_order', label: 'Order', type: 'number' }, { name: 'instructions', label: 'Instructions', type: 'textarea', nullable: true }, { name: 'enabled', label: 'Enabled', type: 'checkbox' },
        ]}
        defaults={{ type: 'bank', enabled: true, fee_percent: '0', sort_order: 0 }}
        columns={[{ key: 'label', label: 'Method', render: (r) => <strong>{r.label}</strong> }, { key: 'type', label: 'Type' }, { key: 'account', label: 'Account', render: (r) => [r.bank_name, r.account_number, r.iban].filter(Boolean).join(' · ') || '—' }, { key: 'enabled', label: 'Status', render: (r) => <Status value={r.enabled ? 'active' : 'draft'} /> }]} />
    </div>
  );
}
