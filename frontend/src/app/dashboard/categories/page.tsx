'use client';
import { useState } from 'react';
import { ResourcePage, useOptions } from '@/components/ResourcePage';
import { Status, Tabs } from '@/components/ui';

export default function Categories() {
  const [tab, setTab] = useState<'categories' | 'stations'>('categories');
  const stations = useOptions('/r/stations');
  const branches = useOptions('/r/branches');
  return (
    <div className="page">
      <Tabs value={tab} onChange={setTab} items={[{ value: 'categories', label: 'Menu categories' }, { value: 'stations', label: 'Kitchen stations' }]} />
      {tab === 'categories' ? (
        <ResourcePage title="Categories" endpoint="/r/categories" searchable={false}
          fields={[{ name: 'name', label: 'Name', required: true }, { name: 'station_id', label: 'Default kitchen station', type: 'select', options: stations, nullable: true }, { name: 'prep_minutes', label: 'Preparation estimate (minutes)', type: 'number', nullable: true }, { name: 'sort_order', label: 'Sort order', type: 'number' }, { name: 'description', label: 'Description', type: 'textarea', nullable: true }, { name: 'active', label: 'Visible', type: 'checkbox' }]}
          defaults={{ active: true, sort_order: 0 }}
          columns={[{ key: 'name', label: 'Name', render: (r) => <strong>{r.name}</strong> }, { key: 'station_id', label: 'Station', render: (r) => stations.find((s: any) => s.value === r.station_id)?.label || '—' }, { key: 'prep_minutes', label: 'Prep (min)', render: (r) => r.prep_minutes ?? '—' }, { key: 'sort_order', label: 'Order' }, { key: 'active', label: 'Status', render: (r) => <Status value={r.active ? 'active' : 'draft'} /> }]} />
      ) : (
        <ResourcePage title="Stations" subtitle="Items are routed to stations on the kitchen display (e.g. Pizza, BBQ, Drinks, Desserts)." endpoint="/r/stations" searchable={false}
          fields={[{ name: 'name', label: 'Name', required: true }, { name: 'branch_id', label: 'Branch', type: 'select', options: branches, nullable: true }, { name: 'sort_order', label: 'Sort order', type: 'number' }, { name: 'active', label: 'Active', type: 'checkbox' }]}
          defaults={{ active: true, sort_order: 0 }}
          columns={[{ key: 'name', label: 'Station', render: (r) => <strong>{r.name}</strong> }, { key: 'sort_order', label: 'Order' }, { key: 'active', label: 'Status', render: (r) => <Status value={r.active ? 'active' : 'draft'} /> }]} />
      )}
    </div>
  );
}
