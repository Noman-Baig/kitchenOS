'use client';
import { ResourcePage, useOptions } from '@/components/ResourcePage';
import { Status } from '@/components/ui';
import { titleCase } from '@/lib/format';

export default function Taxes() {
  const cats = useOptions('/r/categories');
  return (
    <div className="page">
      <ResourcePage title="Taxes" subtitle="Each tax is shown separately on bills and reports. Taxes marked as liabilities are excluded from revenue and profit." endpoint="/r/taxes" searchable={false}
        fields={[
          { name: 'name', label: 'Name', required: true, placeholder: 'GST, VAT, Service charge…' },
          { name: 'calc_type', label: 'Type', type: 'select', required: true, options: [{ value: 'percent', label: 'Percentage' }, { value: 'fixed', label: 'Fixed amount per bill' }] },
          { name: 'rate', label: 'Rate / amount', type: 'money', required: true },
          { name: 'sort_order', label: 'Display order', type: 'number' },
          { name: 'inclusive', label: 'Prices already include this tax', type: 'checkbox' },
          { name: 'is_liability', label: 'Tax liability (collected for authorities)', type: 'checkbox' },
          { name: 'is_optional', label: 'Optional — staff can deselect per bill', type: 'checkbox' },
          { name: 'default_selected', label: 'Selected by default', type: 'checkbox' },
          { name: 'enabled', label: 'Enabled', type: 'checkbox' },
          { name: 'category_scope', label: 'Only these categories (none = all items)', type: 'multiselect', options: cats, full: true, fromRow: (r) => r.applies_to?.categoryIds || [] },
          { name: 'order_types', label: 'Only these order types (none = all)', type: 'multiselect', full: true, fromRow: (r) => r.order_types || [], options: [{ value: 'dine_in', label: 'Dine-in' }, { value: 'takeaway', label: 'Takeaway' }, { value: 'pickup', label: 'Pickup' }, { value: 'delivery', label: 'Delivery' }] },
          { name: 'effective_from', label: 'Effective from', type: 'date', nullable: true }, { name: 'effective_to', label: 'Effective to', type: 'date', nullable: true },
        ]}
        defaults={{ calc_type: 'percent', is_liability: true, default_selected: true, enabled: true, sort_order: 0 }}
        transform={({ category_scope, order_types, ...d }) => ({ ...d, applies_to: category_scope?.length ? { categoryIds: category_scope } : null, order_types: order_types?.length ? order_types : null, effective_from: d.effective_from ? String(d.effective_from).slice(0, 10) : d.effective_from, effective_to: d.effective_to ? String(d.effective_to).slice(0, 10) : d.effective_to })}
        columns={[
          { key: 'name', label: 'Tax', render: (r) => <strong>{r.name}</strong> },
          { key: 'rate', label: 'Rate', render: (r) => r.calc_type === 'percent' ? `${Number(r.rate)}%` : Number(r.rate).toFixed(2) },
          { key: 'inclusive', label: 'Pricing', render: (r) => (r.inclusive ? 'Inclusive' : 'Exclusive') },
          { key: 'scope', label: 'Applies to', render: (r) => (r.applies_to?.categoryIds?.length || r.applies_to?.itemIds?.length ? 'Selected items' : 'All items') + (r.order_types?.length ? ` · ${r.order_types.map(titleCase).join(', ')}` : '') },
          { key: 'is_optional', label: 'Optional', render: (r) => (r.is_optional ? (r.default_selected ? 'Yes (on)' : 'Yes (off)') : 'No') },
          { key: 'is_liability', label: 'In profit?', render: (r) => (r.is_liability ? 'Excluded' : 'Included') },
          { key: 'enabled', label: 'Status', render: (r) => <Status value={r.enabled ? 'active' : 'draft'} /> },
        ]} />
    </div>
  );
}
