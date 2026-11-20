'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { dateOnly, money } from '@/lib/format';
import { useSession } from '@/components/Session';
import { Empty, Modal, PageHead, Status, useAction } from '@/components/ui';

export default function Payroll() {
  const s = useSession();
  const d = new Date();
  const start = new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(d.getFullYear(), d.getMonth() + 1, 0)).toISOString().slice(0, 10);
  const [period, setPeriod] = useState(start);
  const list = useApi<any>(`/r/payroll${period ? `?periodStart=${period}` : ''}`);
  const [edit, setEdit] = useState<any>(null);
  const [adv, setAdv] = useState<any>(null);
  const [run, busy] = useAction();
  const rows = list.data?.data || [];
  const total = rows.reduce((a: number, r: any) => a + Number(r.net_pay), 0);
  return (
    <div className="page">
      <PageHead title="Payroll" subtitle={`Entries are generated monthly for staff with a salary (set salary in Staff). Period total: ${money(total, s.currency)}`} actions={<>
        <input className="input" type="date" style={{ width: 160 }} value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Period start" />
        <button className="btn" onClick={async () => { const r = await run(() => api('/r/payroll/generate', { body: { periodStart: start, periodEnd: end } })); if (r) { list.reload(); } }}>Generate this month</button></>} />
      {!list.data ? <div className="skeleton" /> : rows.length === 0 ? <Empty title="No payroll entries for this period">Use “Generate this month” or set salaries in Staff.</Empty> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Employee</th><th>Period</th><th className="num">Base</th><th className="num">Bonuses</th><th className="num">Deductions</th><th className="num">Advances</th><th className="num">Net pay</th><th>Status</th><th /></tr></thead>
          <tbody>{rows.map((r: any) => <tr key={r.id}><td><strong>{r.employee}</strong></td><td className="small">{dateOnly(r.period_start)} – {dateOnly(r.period_end)}</td><td className="num">{money(r.base_salary, s.currency)}</td><td className="num">{money(r.bonuses, s.currency)}</td><td className="num">{money(r.deductions, s.currency)}</td><td className="num">{money(r.advances, s.currency)}</td><td className="num"><strong>{money(r.net_pay, s.currency)}</strong></td><td><Status value={r.status} /></td>
            <td className="right nowrap">{r.status === 'unpaid' && <><button className="btn btn-sm" onClick={() => setEdit({ id: r.id, bonuses: r.bonuses, deductions: r.deductions, baseSalary: r.base_salary, notes: r.notes || '' })}>Edit</button> <button className="btn btn-sm" onClick={() => setAdv({ id: r.id, amount: '', paidVia: 'cash' })}>Advance</button> <button className="btn btn-sm btn-primary" onClick={async () => { await run(() => api(`/r/payroll/${r.id}/pay`, { body: { paidVia: 'bank' } }), 'Marked paid'); list.reload(); }}>Pay</button></>}</td></tr>)}</tbody></table></div>
      )}
      <Modal open={!!edit} title="Edit payroll entry" onClose={() => setEdit(null)}>{edit && <div className="stack">
        <label className="field">Base salary<input className="input" type="number" min="0" step="0.01" value={edit.baseSalary} onChange={(e) => setEdit({ ...edit, baseSalary: e.target.value })} /></label>
        <label className="field">Bonuses<input className="input" type="number" min="0" step="0.01" value={edit.bonuses} onChange={(e) => setEdit({ ...edit, bonuses: e.target.value })} /></label>
        <label className="field">Deductions<input className="input" type="number" min="0" step="0.01" value={edit.deductions} onChange={(e) => setEdit({ ...edit, deductions: e.target.value })} /></label>
        <label className="field">Notes<input className="input" value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></label>
        <button className="btn btn-primary" disabled={busy} onClick={async () => { const r = await run(() => api(`/r/payroll/${edit.id}`, { method: 'PATCH', body: { baseSalary: String(edit.baseSalary), bonuses: String(edit.bonuses), deductions: String(edit.deductions), notes: edit.notes || null } }), 'Saved'); if (r) { setEdit(null); list.reload(); } }}>Save</button></div>}</Modal>
      <Modal open={!!adv} title="Pay salary advance" onClose={() => setAdv(null)}>{adv && <div className="stack">
        <label className="field">Amount<input className="input" type="number" min="0" step="0.01" value={adv.amount} onChange={(e) => setAdv({ ...adv, amount: e.target.value })} /></label>
        <label className="field">Paid via<select className="input" value={adv.paidVia} onChange={(e) => setAdv({ ...adv, paidVia: e.target.value })}><option value="cash">Cash</option><option value="bank">Bank</option></select></label>
        <button className="btn btn-primary" disabled={busy || !(Number(adv.amount) > 0)} onClick={async () => { const r = await run(() => api(`/r/payroll/${adv.id}/advance`, { body: { amount: adv.amount, paidVia: adv.paidVia } }), 'Advance recorded'); if (r) { setAdv(null); list.reload(); } }}>Pay advance</button></div>}</Modal>
    </div>
  );
}
