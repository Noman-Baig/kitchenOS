'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { dateOnly, money, titleCase } from '@/lib/format';
import { useSession } from '@/components/Session';
import { ResourcePage, useOptions } from '@/components/ResourcePage';
import { ConfirmButton, Drawer, Empty, PageHead, Status, Tabs, useAction } from '@/components/ui';

const CATS = ['rent', 'electricity', 'water', 'gas', 'salaries', 'purchases', 'repairs', 'marketing', 'delivery', 'maintenance', 'other'];

export default function Expenses() {
  const s = useSession();
  const [tab, setTab] = useState<'expenses' | 'recurring'>('expenses');
  const [cat, setCat] = useState('');
  const list = useApi<any>(`/r/expenses?pageSize=200${cat ? `&category=${cat}` : ''}`);
  const branches = useOptions('/r/branches');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ category: 'rent', amount: '', expenseDate: new Date().toISOString().slice(0, 10), description: '', paidVia: 'bank', branchId: '' });
  const [run, busy] = useAction();
  const total = (list.data?.data || []).reduce((a: number, e: any) => a + Number(e.amount), 0);
  return (
    <div className="page">
      <Tabs value={tab} onChange={setTab} items={[{ value: 'expenses', label: 'Expenses' }, { value: 'recurring', label: 'Recurring' }]} />
      {tab === 'expenses' ? <>
        <PageHead title="Expenses" subtitle={`Shown: ${money(total, s.currency)}`} actions={<><select className="input" style={{ width: 160 }} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category"><option value="">All categories</option>{CATS.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</select><button className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Add expense</button></>} />
        {!list.data ? <div className="skeleton" /> : list.data.data.length === 0 ? <Empty title="No expenses recorded" /> : <div className="table-wrap"><table className="table"><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Branch</th><th>Paid via</th><th className="num">Amount</th><th /></tr></thead>
          <tbody>{list.data.data.map((e: any) => <tr key={e.id}><td>{dateOnly(e.expense_date)}</td><td>{titleCase(e.category)}{e.recurring_id ? <span className="badge" style={{ marginLeft: 6 }}>recurring</span> : null}</td><td className="small">{e.description}</td><td className="small">{e.branch_name || '—'}</td><td>{titleCase(e.paid_via)}</td><td className="num">{money(e.amount, s.currency)}</td><td className="right"><ConfirmButton label="Delete" confirm="Delete this expense? The ledger entry will be reversed." onConfirm={async () => { await run(() => api(`/r/expenses/${e.id}`, { method: 'DELETE' }), 'Deleted'); list.reload(); }} /></td></tr>)}</tbody></table></div>}
        <Drawer open={open} title="Add expense" onClose={() => setOpen(false)} footer={<button className="btn btn-primary" disabled={busy || !(Number(f.amount) > 0)} onClick={async () => { const r = await run(() => api('/r/expenses', { body: { ...f, description: f.description || null, branchId: f.branchId ? Number(f.branchId) : null } }), 'Expense added'); if (r) { setOpen(false); setF({ ...f, amount: '', description: '' }); list.reload(); } }}>Save</button>}>
          <div className="form-grid">
            <label className="field">Category<select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}</select></label>
            <label className="field">Amount ({s.currency})<input className="input" type="number" min="0" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
            <label className="field">Date<input className="input" type="date" value={f.expenseDate} onChange={(e) => setF({ ...f, expenseDate: e.target.value })} /></label>
            <label className="field">Paid via<select className="input" value={f.paidVia} onChange={(e) => setF({ ...f, paidVia: e.target.value })}><option value="bank">Bank</option><option value="cash">Cash</option></select></label>
            <label className="field">Branch<select className="input" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}><option value="">—</option>{branches.map((b: any) => <option key={b.value} value={b.value}>{b.label}</option>)}</select></label>
            <label className="field full">Description<input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
          </div>
          <p className="small muted">Salaries paid through Payroll are recorded automatically — do not add them here as well.</p>
        </Drawer>
      </> : <ResourcePage title="Recurring expenses" subtitle="Generated automatically on the next run date (rent, utilities, subscriptions)." endpoint="/r/recurring-expenses" searchable={false}
        fields={[{ name: 'category', label: 'Category', type: 'select', required: true, options: CATS.map((c) => ({ value: c, label: titleCase(c) })) }, { name: 'amount', label: 'Amount', type: 'money', required: true }, { name: 'frequency', label: 'Frequency', type: 'select', required: true, options: [{ value: 'monthly', label: 'Monthly' }, { value: 'weekly', label: 'Weekly' }] }, { name: 'next_run_date', label: 'Next date', type: 'date', required: true }, { name: 'paid_via', label: 'Paid via', type: 'select', required: true, options: [{ value: 'bank', label: 'Bank' }, { value: 'cash', label: 'Cash' }] }, { name: 'branch_id', label: 'Branch', type: 'select', options: branches, nullable: true }, { name: 'description', label: 'Description', nullable: true, full: true }, { name: 'active', label: 'Active', type: 'checkbox' }]}
        defaults={{ category: 'rent', frequency: 'monthly', paid_via: 'bank', active: true, next_run_date: new Date().toISOString().slice(0, 10) }}
        transform={(d) => ({ ...d, next_run_date: d.next_run_date ? String(d.next_run_date).slice(0, 10) : undefined })}
        columns={[{ key: 'category', label: 'Category', render: (r) => titleCase(r.category) }, { key: 'description', label: 'Description', render: (r) => r.description || '—' }, { key: 'amount', label: 'Amount', className: 'num', render: (r) => money(r.amount, s.currency) }, { key: 'frequency', label: 'Every', render: (r) => titleCase(r.frequency) }, { key: 'next_run_date', label: 'Next', render: (r) => dateOnly(r.next_run_date) }, { key: 'active', label: 'Status', render: (r) => <Status value={r.active ? 'active' : 'draft'} /> }]} />}
    </div>
  );
}
