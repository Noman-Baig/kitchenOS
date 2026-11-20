'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { Printer as PrinterIcon, FileDown } from 'lucide-react';
import { api, download, idemKey } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useStaffEvents } from '@/lib/socket';
import { dt, money, titleCase } from '@/lib/format';
import { printReceipt } from '@/lib/print';
import { useSession } from '@/components/Session';
import { ConfirmButton, Modal, PageHead, Skeleton, Status, useAction, useToast } from '@/components/ui';

export default function BillDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const s = useSession(); const toast = useToast(); const cur = s.currency;
  const { data, reload } = useApi<any>(`/r/bills/${id}`);
  const printers = useApi<any>('/r/printers?pageSize=50');
  const methods = useApi<any>('/r/payment-methods?pageSize=50');
  const [run, busy] = useAction();
  const [pay, setPay] = useState<{ methodType: string; methodId: string; amount: string; reference: string; splitLabel: string } | null>(null);
  const [split, setSplit] = useState(false);
  const [splitRes, setSplitRes] = useState<string[] | null>(null);
  const [splitMode, setSplitMode] = useState<'equal' | 'items' | 'custom'>('equal');
  const [parts, setParts] = useState(2);
  const [groups, setGroups] = useState<Record<number, number>>({});
  const [custom, setCustom] = useState('');
  const [refund, setRefund] = useState<{ amount: string; reason: string; methodType: string; restock: boolean } | null>(null);
  const [disc, setDisc] = useState<{ type: string; value: string; coupon: string } | null>(null);
  useStaffEvents({ 'bill:updated': (p) => { if (String(p.billId) === id) reload(); } }, reload);
  const b = data?.data;
  if (!b) return <div className="page"><Skeleton rows={8} /></div>;
  const due = Number(b.balance_due);
  const lines = b.orders.filter((o: any) => !['rejected', 'cancelled', 'draft'].includes(o.status)).flatMap((o: any) => o.items.filter((i: any) => i.status !== 'cancelled'));
  const optional = (b.availableTaxes || []).filter((t: any) => t.is_optional);
  const selected: number[] = b.tax_selection ?? optional.filter((t: any) => t.default_selected).map((t: any) => t.id);
  const printer = (printers.data?.data || []).find((p: any) => p.is_default) || (printers.data?.data || [])[0] || null;
  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <PageHead title={`Bill ${b.bill_no}`} subtitle={`${b.customer_name || 'Guest'} · ${titleCase(b.channel)} · ${titleCase(b.order_type)} · opened ${dt(b.opened_at, s.tz)}`} actions={<>
        <Status value={b.status} /><Status value={b.payment_status} />
        <button className="btn" onClick={async () => { try { await printReceipt(b.id, printer); toast('Printed'); } catch (e: any) { toast(e.message, 'error'); } }}><PrinterIcon size={15} /> {b.status === 'closed' ? 'Reprint' : 'Print'}</button>
        <button className="btn" onClick={() => download(`/r/bills/${b.id}/receipt?format=pdf`, `invoice-${b.bill_no}.pdf`)}><FileDown size={15} /> PDF</button>
      </>} />
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)' }}>
        <div className="stack">
          {b.orders.map((o: any) => (
            <div key={o.id} className="card">
              <div className="row-between mb"><strong>Order {o.order_no}{o.is_addition ? ' · addition' : ''}</strong><Status value={o.status} /></div>
              {o.items.map((i: any) => <div key={i.id} className="row-between small" style={{ padding: '4px 0', textDecoration: i.status === 'cancelled' ? 'line-through' : undefined, color: i.status === 'cancelled' ? 'var(--muted)' : undefined }}><span>{i.quantity}× {i.name}{i.variant_name ? ` (${i.variant_name})` : ''}{i.addons?.length ? ` + ${i.addons.map((a: any) => a.name).join(', ')}` : ''}{i.is_complimentary ? ' · complimentary' : ''}</span><span>{money(i.line_total, cur)}</span></div>)}
            </div>
          ))}
          <div className="card"><h3>Payments</h3>
            {b.payments.length === 0 ? <div className="small muted">No payments yet</div> : b.payments.map((p: any) => (
              <div key={p.id} className="row-between small" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <span>{titleCase(p.method_type)}{p.split_label ? ` · ${p.split_label}` : ''}{p.reference ? ` · ${p.reference}` : ''} <Status value={p.status} />{p.rejection_reason ? <span className="muted"> — {p.rejection_reason}</span> : null}</span>
                <span className="row">{money(p.amount, cur)}{p.proofUrl && <a className="btn btn-sm" href={p.proofUrl} target="_blank" rel="noreferrer">Proof</a>}
                  {['submitted', 'under_review', 'cash_requested'].includes(p.status) && s.can('payments.approve') && <><button className="btn btn-sm btn-primary" onClick={async () => { await run(() => api(`/r/payments/${p.id}/approve`, { body: {} }), p.status === 'cash_requested' ? 'Cash collected' : 'Payment approved'); reload(); }}>{p.status === 'cash_requested' ? 'Collected' : 'Approve'}</button>
                    <ConfirmButton label="Reject" confirm="Reject this payment?" reason="Reason shown to the customer" onConfirm={async (r) => { await run(() => api(`/r/payments/${p.id}/reject`, { body: { reason: r } }), 'Rejected'); reload(); }} /></>}</span>
              </div>))}
            {b.refunds.map((r: any) => <div key={r.id} className="row-between small" style={{ padding: '6px 0', color: 'var(--danger)' }}><span>Refund · {r.reason}</span><span>-{money(r.amount, cur)}</span></div>)}
          </div>
        </div>
        <div className="stack">
          <div className="card stack" style={{ gap: 6 }}>
            <div className="row-between"><span>Subtotal</span><span>{money(b.subtotal, cur)}</span></div>
            {Number(b.discount_total) > 0 && <div className="row-between"><span>Discount{b.discount?.code ? ` (${b.discount.code})` : b.discount?.source === 'loyalty' ? ' (loyalty)' : ''}</span><span>-{money(b.discount_total, cur)}</span></div>}
            {b.taxes.map((t: any) => <div key={t.tax_id} className="row-between muted"><span>{t.name} {Number(t.rate)}%{t.inclusive ? ' (incl.)' : ''}</span><span>{money(t.amount, cur)}</span></div>)}
            {Number(b.delivery_charge) > 0 && <div className="row-between"><span>Delivery</span><span>{money(b.delivery_charge, cur)}</span></div>}
            <div className="row-between" style={{ fontSize: 18, fontWeight: 700 }}><span>Total</span><span>{money(b.total, cur)}</span></div>
            <div className="row-between"><span>Paid</span><span>{money(b.paid_total, cur)}</span></div>
            {Number(b.refunded_total) > 0 && <div className="row-between"><span>Refunded</span><span>-{money(b.refunded_total, cur)}</span></div>}
            <div className="row-between"><strong>Balance due</strong><strong>{money(Math.max(0, due), cur)}</strong></div>
          </div>
          {b.status === 'open' && <div className="card stack">
            {optional.length > 0 && s.can('payments.approve') && <div><div className="section-title" style={{ marginTop: 0 }}>Optional taxes</div><div className="row">{optional.map((t: any) => <label key={t.id} className="check"><input type="checkbox" checked={selected.includes(t.id)} onChange={async (e) => { const next = e.target.checked ? [...selected, t.id] : selected.filter((x) => x !== t.id); await run(() => api(`/r/bills/${b.id}/adjust`, { body: { taxSelection: next } })); reload(); }} />{t.name} ({Number(t.rate)}%)</label>)}</div></div>}
            {s.can('discounts.apply') && <button className="btn" onClick={() => setDisc({ type: 'percent', value: '', coupon: '' })}>Discount / coupon</button>}
            {s.can('payments.approve') && due > 0 && <><button className="btn btn-primary" onClick={() => setPay({ methodType: 'cash', methodId: '', amount: due.toFixed(2), reference: '', splitLabel: '' })}>Record payment</button><button className="btn" onClick={() => setSplit(true)}>Split bill</button></>}
            {s.can('payments.approve') && <ConfirmButton danger={due > 0} label={due > 0 ? 'Close with balance due' : 'Close bill'} confirm={due > 0 ? `This bill still has ${money(due, cur)} due. It will be recorded as a neutral billing discrepancy.` : 'Close this bill?'} reason={due > 0 ? 'Reason' : undefined} onConfirm={async (r) => { await run(() => api(`/r/bills/${b.id}/close`, { body: { force: due > 0, reason: r } }), 'Bill closed'); reload(); }} className="btn" />}
            {s.can('pos.cancel') && Number(b.paid_total) === 0 && <ConfirmButton label="Void bill" confirm="Void this bill and cancel all its orders? Stock will be returned." reason="Reason" onConfirm={async (r) => { await run(() => api(`/r/bills/${b.id}/void`, { body: { reason: r } }), 'Bill voided'); reload(); }} className="btn" />}
          </div>}
          {b.status === 'closed' && s.can('pos.refund') && Number(b.paid_total) > Number(b.refunded_total) && <button className="btn" onClick={() => setRefund({ amount: (Number(b.paid_total) - Number(b.refunded_total)).toFixed(2), reason: '', methodType: 'cash', restock: false })}>Refund</button>}
          <Link className="small link" href="/dashboard/bills">← All bills</Link>
        </div>
      </div>

      <Modal open={!!pay} title="Record payment" onClose={() => setPay(null)}>
        {pay && <div className="stack">
          <label className="field">Method<select className="input" value={pay.methodId ? `m${pay.methodId}` : pay.methodType} onChange={(e) => { const m = (methods.data?.data || []).find((x: any) => `m${x.id}` === e.target.value); setPay({ ...pay, methodType: m ? (m.type === 'cash' ? 'cash' : m.type) : e.target.value, methodId: m ? String(m.id) : '' }); }}><option value="cash">Cash</option><option value="card">Card terminal</option>{(methods.data?.data || []).filter((m: any) => m.type !== 'cash').map((m: any) => <option key={m.id} value={`m${m.id}`}>{m.label}</option>)}</select></label>
          <label className="field">Amount<input className="input" type="number" min="0" step="0.01" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></label>
          <label className="field">Reference<input className="input" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></label>
          <label className="field">Split label (optional)<input className="input" value={pay.splitLabel} onChange={(e) => setPay({ ...pay, splitLabel: e.target.value })} placeholder="e.g. Guest 2" /></label>
          <button className="btn btn-primary" disabled={busy || !(Number(pay.amount) > 0)} onClick={async () => { const r = await run(() => api(`/r/bills/${b.id}/payments`, { body: { methodType: pay.methodType, methodId: pay.methodId ? Number(pay.methodId) : null, amount: pay.amount, reference: pay.reference || null, splitLabel: pay.splitLabel || null, idempotencyKey: idemKey() } }), 'Payment recorded'); if (r) { setPay(null); reload(); } }}>Save payment</button>
        </div>}
      </Modal>

      <Modal open={split} title="Split bill" onClose={() => { setSplit(false); setSplitRes(null); }}>
        <div className="stack">
          <div className="segmented">{(['equal', 'items', 'custom'] as const).map((m) => <button key={m} className={splitMode === m ? 'active' : ''} onClick={() => { setSplitMode(m); setSplitRes(null); }}>{titleCase(m === 'items' ? 'by items' : m)}</button>)}</div>
          {splitMode === 'equal' && <label className="field">Number of people<input className="input" type="number" min={2} max={50} value={parts} onChange={(e) => setParts(Number(e.target.value))} /></label>}
          {splitMode === 'items' && <div className="stack" style={{ gap: 4 }}><div className="small muted">Assign each item to a guest number.</div>{lines.map((l: any) => <div key={l.id} className="row-between small"><span>{l.quantity}× {l.name}</span><input className="input" style={{ width: 70 }} type="number" min={1} max={20} value={groups[l.id] || 1} onChange={(e) => setGroups({ ...groups, [l.id]: Number(e.target.value) })} aria-label={`Guest for ${l.name}`} /></div>)}</div>}
          {splitMode === 'custom' && <label className="field">Amounts (comma separated)<input className="input" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={`${(due / 2).toFixed(2)}, ${(due / 2).toFixed(2)}`} /></label>}
          <button className="btn" onClick={async () => {
            const body: any = { mode: splitMode };
            if (splitMode === 'equal') body.parts = parts;
            if (splitMode === 'custom') body.amounts = custom.split(',').map((x) => x.trim()).filter(Boolean);
            if (splitMode === 'items') { const g: Record<number, number[]> = {}; lines.forEach((l: any) => { const k = groups[l.id] || 1; (g[k] ||= []).push(l.id); }); body.groups = Object.keys(g).sort().map((k) => g[Number(k)]); }
            const r = await run(() => api(`/r/bills/${b.id}/split-preview`, { body })); if (r) setSplitRes(r.data.parts);
          }}>Calculate</button>
          {splitRes && <div className="stack" style={{ gap: 6 }}>{splitRes.map((p, i) => <div key={i} className="row-between"><span>Guest {i + 1}</span><span className="row">{money(p, cur)}<button className="btn btn-sm btn-primary" onClick={() => { setSplit(false); setPay({ methodType: 'cash', methodId: '', amount: Number(p).toFixed(2), reference: '', splitLabel: `Guest ${i + 1}` }); }}>Take payment</button></span></div>)}</div>}
        </div>
      </Modal>

      <Modal open={!!refund} title="Refund" onClose={() => setRefund(null)}>
        {refund && <div className="stack">
          <label className="field">Amount<input className="input" type="number" min="0" step="0.01" value={refund.amount} onChange={(e) => setRefund({ ...refund, amount: e.target.value })} /></label>
          <label className="field">Refund via<select className="input" value={refund.methodType} onChange={(e) => setRefund({ ...refund, methodType: e.target.value })}><option value="cash">Cash</option><option value="bank">Bank</option><option value="card">Card</option><option value="wallet">Wallet</option></select></label>
          <label className="field">Reason<input className="input" value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} /></label>
          <label className="check"><input type="checkbox" checked={refund.restock} onChange={(e) => setRefund({ ...refund, restock: e.target.checked })} /> Return ingredients to stock (food was not prepared/served)</label>
          <button className="btn btn-primary" disabled={busy || refund.reason.length < 2} onClick={async () => { const r = await run(() => api(`/r/bills/${b.id}/refund`, { body: refund }), 'Refund recorded'); if (r) { setRefund(null); reload(); } }}>Refund</button>
        </div>}
      </Modal>

      <Modal open={!!disc} title="Discount or coupon" onClose={() => setDisc(null)}>
        {disc && <div className="stack">
          <div className="row"><select className="input" style={{ width: 120 }} value={disc.type} onChange={(e) => setDisc({ ...disc, type: e.target.value })}><option value="percent">Percent</option><option value="fixed">Amount</option></select><input className="input grow" type="number" min="0" step="0.01" placeholder="Value" value={disc.value} onChange={(e) => setDisc({ ...disc, value: e.target.value })} /></div>
          <button className="btn btn-primary" disabled={!disc.value} onClick={async () => { const r = await run(() => api(`/r/bills/${b.id}/adjust`, { body: { discount: { type: disc.type, value: disc.value } } }), 'Discount applied'); if (r) { setDisc(null); reload(); } }}>Apply discount</button>
          <hr style={{ margin: '4px 0' }} />
          <div className="row"><input className="input grow" placeholder="Coupon code" value={disc.coupon} onChange={(e) => setDisc({ ...disc, coupon: e.target.value.toUpperCase() })} /><button className="btn" disabled={!disc.coupon} onClick={async () => { const r = await run(() => api(`/r/bills/${b.id}/adjust`, { body: { couponCode: disc.coupon } }), 'Coupon applied'); if (r) { setDisc(null); reload(); } }}>Apply coupon</button></div>
          {b.discount && <button className="btn btn-ghost" onClick={async () => { await run(() => api(`/r/bills/${b.id}/adjust`, { body: { discount: null } }), 'Discount removed'); setDisc(null); reload(); }}>Remove current discount</button>}
        </div>}
      </Modal>
    </div>
  );
}
