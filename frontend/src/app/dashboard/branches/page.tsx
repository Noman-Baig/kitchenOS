'use client';
import { ResourcePage } from '@/components/ResourcePage';
import { Status } from '@/components/ui';

export default function Branches() {
  return (
    <div className="page">
      <ResourcePage title="Branches" subtitle="Branch limits depend on your plan. Reports can be filtered by branch or consolidated." endpoint="/r/branches" searchable={false} deleteLabel="Deactivate"
        fields={[{ name: 'name', label: 'Name', required: true }, { name: 'phone', label: 'Phone', nullable: true }, { name: 'address', label: 'Address', type: 'textarea', nullable: true }, { name: 'active', label: 'Active', type: 'checkbox' }]}
        defaults={{ active: true }}
        columns={[{ key: 'name', label: 'Branch', render: (r) => <strong>{r.name}{r.is_main ? ' (main)' : ''}</strong> }, { key: 'address', label: 'Address', render: (r) => r.address || '—' }, { key: 'phone', label: 'Phone', render: (r) => r.phone || '—' }, { key: 'active', label: 'Status', render: (r) => <Status value={r.active ? 'active' : 'draft'} /> }]} />
    </div>
  );
}
