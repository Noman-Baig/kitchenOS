'use client';
import { ResourcePage } from '@/components/ResourcePage';

export default function Suppliers() {
  return (
    <div className="page">
      <ResourcePage title="Suppliers" endpoint="/r/suppliers" deleteLabel="Archive"
        fields={[{ name: 'name', label: 'Name', required: true }, { name: 'contact_name', label: 'Contact person', nullable: true }, { name: 'phone', label: 'Phone', nullable: true }, { name: 'email', label: 'Email', type: 'email', nullable: true }, { name: 'address', label: 'Address', type: 'textarea', nullable: true }]}
        columns={[{ key: 'name', label: 'Supplier', render: (r) => <strong>{r.name}</strong> }, { key: 'contact_name', label: 'Contact', render: (r) => r.contact_name || '—' }, { key: 'phone', label: 'Phone', render: (r) => r.phone || '—' }, { key: 'email', label: 'Email', render: (r) => r.email || '—' }]} />
    </div>
  );
}
