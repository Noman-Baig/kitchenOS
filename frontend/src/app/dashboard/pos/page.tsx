'use client';
import { useEffect, useMemo, useState } from 'react';
import { Minus, PauseCircle, Plus, Printer as PrinterIcon, Trash2 } from 'lucide-react';
import { api, idemKey } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { money } from '@/lib/format';
import { printReceipt } from '@/lib/print';
import { useSession } from '@/components/Session';
import { Drawer, Modal, useAction, useToast } from '@/components/ui';
import { ItemOptions, MenuGrid, toApiLines, type CartLine } from '@/components/MenuPicker';

type Pay = { methodType: 'cash' | 'card' | 'bank' | 'wallet' | 'other'; methodId?: number | null; amount: string; reference?: string };

export default function Pos() {
  const s = useSession();
  const toast = useToast();
  const menu = useApi<any>('/r/menu');
  const tables = useApi<any>('/r/tables?pageSize=200');
  const methods = useApi<any>('/r/payment-methods?pageSize=50');
  const printers = useApi<any>('/r/printers?pageSize=50');
  const shift = useApi<any>('/r/pos/shift');
  const held = useApi<any>('/r/pos/held');
  const [lines, setLines] = useState<CartLine[]>([]);
  const [pick, setPick] = useState<any>(null);
  const [orderType, setOrderType] = useState<'takeaway' | 'dine_in' | 'pickup' | 'delivery'>('takeaway');
  const [tableId, setTableId] = useState('');
  const [customer, setCustomer] = useState('');
  const [discount, setDiscount] = useState<{ type: 'percent' | 'fixed'; value: string } | null>(null);
  const [coupon, setCoupon] = useState('');
  const [taxSel, setTaxSel] = useState<number[] | null>(null);
  const [quote, setQuote] = useState<any>(null);
  const [charging, setCharging] = useState(false);
  const [pays, setPays] = useState<Pay[]>([]);
  const [tendered, setTendered] = useState('');
  const [result, setResult] = useState<any>(null);
  const [showHeld, setShowHeld] = useState(false);
  const [shiftModal, setShiftModal] = useState<'open' | 'close' | null>(null);
  const [cash, setCash] = useState('');
  const [run, busy] = useAction();
  const cur = s.currency;
  const printer = useMemo(() => (printers.data?.data || []).find((p: any) => p.is_default && p.purpose !== 'kitchen') || (printers.data?.data || [])[0] || null, [printers.data]);

  useEffect(() => {
    if (!lines.length) { setQuote(null); return; }
    const c = new AbortController();
    const t = setTimeout(() => api('/r/pos/quote', { body: { orderType, lines: toApiLines(lines), discount, taxSelection: taxSel }, signal: c.signal }).then((r) => { setQuote(r.data); if (taxSel === null) setTaxSel(r.data.optionalTaxes.filter((x: any) => x.defaultSelected).map((x: any) => x.id)); }).catch((e) => { if (e.name !== 'AbortError') toast(e.message, 'error'); }), 250);
    return () => { clearTimeout(t); c.abort(); };
  }, [lines, orderType, discount, taxSel]); // eslint-disable-line

  const reset = () => { setLines([]); setDiscount(null); setCoupon(''); setCustomer(''); setTableId(''); setPays([]); setTendered(''); setTaxSel(null); setCharging(false); };
  const sale = async (hold: boolean) => {
    const r = await run(() => api('/r/pos/sales', { body: { idempotencyKey: idemKey(), orderType, tableId: tableId ? Number(tableId) : null, customerName: customer || null, lines: toApiLines(lines), hold, discount, couponCode: coupon || null, taxSelection: taxSel, payments: hold ? [] : pays.filter((p) => Number(p.amount) > 0), cashTendered: tendered || null } }), hold ? 'Order held' : 'Sale recorded');
    if (r) { setResult(r.data); reset(); held.reload(); shift.reload(); }
  };
  const total = Number(quote?.total || 0);
  const paid = pays.reduce((a, p) => a + Number(p.amount || 0), 0);

  if (shift.data && !shift.data.data) return (
    <div className="page" style={{ maxWidth: 420 }}>
      <div className="card stack"><h2>Open a shift</h2><p className="muted small">Count the cash in your drawer. Cash sales and refunds are reconciled against this when you close the shift.</p>
        <label className="field">Opening cash ({cur})<input className="input" type="number" min="0" step="0.01" value={cash} onChange={(e) => setCash(e.target.value)} /></label>
        <button className="btn btn-primary" disabled={busy || cash === ''} onClick={async () => { await run(() => api('/r/pos/shift/open', { body: { openingCash: cash } }), 'Shift opened'); setCash(''); shift.reload(); }}>Open shift</button></div>
    </div>
  );

  return (
    <div className="pos">
      <div className="pos-menu"><MenuGrid menu={menu.data?.data} currency={cur} onPick={setPick} /></div>
      <aside className="pos-cart">
        <div style={{ padding: 14, borderBottom: '1px solid var(--border)' }} className="stack">
          <div className="segmented">{(['takeaway', 'dine_in', 'pickup', 'delivery'] as const).map((t) => <button key={t} className={orderType === t ? 'active' : ''} onClick={() => setOrderType(t)}>{t === 'dine_in' ? 'Dine-in' : t[0].toUpperCase() + t.slice(1)}</button>)}</div>
          <div className="row">{orderType === 'dine_in' && <select className="input grow" value={tableId} onChange={(e) => setTableId(e.target.value)} aria-label="Table"><option value="">Table…</option>{(tables.data?.data || []).map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
            <input className="input grow" placeholder="Customer name (optional)" value={customer} onChange={(e) => setCustomer(e.target.value)} /></div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 14px' }}>
          {lines.length === 0 && <div className="empty small">Tap items to add them</div>}
          {lines.map((l) => (
            <div key={l.key} className="row-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div className="grow"><div className="small" style={{ fontWeight: 600 }}>{l.name}{l.variantName ? ` (${l.variantName})` : ''}{l.complimentary ? ' · comp' : ''}</div>{(l.addonNames.length > 0 || l.notes) && <div className="tiny muted">{[...l.addonNames, l.notes].filter(Boolean).join(' · ')}</div>}<div className="tiny muted">{money(l.unit, cur)}</div></div>
              <div className="row" style={{ gap: 4 }}>
                <button className="btn btn-sm icon-btn" onClick={() => setLines(lines.map((x) => x.key === l.key ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x))} aria-label="Decrease"><Minus size={14} /></button>
                <span style={{ minWidth: 22, textAlign: 'center' }}>{l.quantity}</span>
                <button className="btn btn-sm icon-btn" onClick={() => setLines(lines.map((x) => x.key === l.key ? { ...x, quantity: Math.min(99, x.quantity + 1) } : x))} aria-label="Increase"><Plus size={14} /></button>
                <button className="btn btn-sm btn-ghost icon-btn" onClick={() => setLines(lines.filter((x) => x.key !== l.key))} aria-label="Remove"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: 14, borderTop: '1px solid var(--border)' }} className="stack">
          {s.can('discounts.apply') && <div className="row" style={{ gap: 6 }}>
            <select className="input" style={{ width: 90 }} value={discount?.type || ''} onChange={(e) => setDiscount(e.target.value ? { type: e.target.value as any, value: discount?.value || '0' } : null)} aria-label="Discount type"><option value="">No disc.</option><option value="percent">%</option><option value="fixed">{cur}</option></select>
            {discount && <input className="input" style={{ width: 90 }} type="number" min="0" value={discount.value} onChange={(e) => setDiscount({ ...discount, value: e.target.value || '0' })} aria-label="Discount value" />}
            <input className="input grow" placeholder="Coupon" value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} />
          </div>}
          {quote?.optionalTaxes?.length > 0 && <div className="row small">{quote.optionalTaxes.map((t: any) => <label key={t.id} className="check"><input type="checkbox" checked={!!taxSel?.includes(t.id)} onChange={(e) => setTaxSel(e.target.checked ? [...(taxSel || []), t.id] : (taxSel || []).filter((x) => x !== t.id))} />{t.name}</label>)}</div>}
          {quote && <div className="small stack" style={{ gap: 2 }}>
            <div className="row-between"><span>Subtotal</span><span>{money(quote.subtotal, cur)}</span></div>
            {Number(quote.discountTotal) > 0 && <div className="row-between"><span>Discount</span><span>-{money(quote.discountTotal, cur)}</span></div>}
            {quote.taxes.map((t: any) => <div key={t.taxId} className="row-between muted"><span>{t.name} {Number(t.rate)}%{t.inclusive ? ' (incl.)' : ''}</span><span>{money(t.amount, cur)}</span></div>)}
            <div className="row-between" style={{ fontSize: 17, fontWeight: 700 }}><span>Total</span><span>{money(quote.total, cur)}</span></div>
            {coupon && <div className="tiny muted">Coupon is validated when the sale is recorded.</div>}
          </div>}
          <div className="row">
            <button className="btn" disabled={!lines.length || busy} onClick={() => sale(true)}><PauseCircle size={16} /> Hold</button>
            <button className="btn btn-primary grow btn-lg" disabled={!lines.length || busy || !quote || (orderType === 'dine_in' && !tableId)} onClick={() => { setPays([{ methodType: 'cash', amount: total.toFixed(2) }]); setCharging(true); }}>Charge {quote ? money(quote.total, cur) : ''}</button>
          </div>
          <div className="row small"><button className="btn btn-sm btn-ghost" onClick={() => setShowHeld(true)}>Held ({held.data?.data.length || 0})</button><button className="btn btn-sm btn-ghost" onClick={() => setShiftModal('close')}>Close shift</button><span className="grow" /><span className="muted tiny">{printer ? `Printer: ${printer.name}` : 'Browser printing'}</span></div>
        </div>
      </aside>

      {pick && <ItemOptions item={pick} currency={cur} allowComp={s.can('discounts.apply')} onAdd={(l) => setLines([...lines, l])} onClose={() => setPick(null)} />}

      <Modal open={charging} title={`Charge ${money(total, cur)}`} onClose={() => setCharging(false)}>
        <div className="stack">
          {pays.map((p, i) => (
            <div key={i} className="row">
              <select className="input" style={{ width: 150 }} value={p.methodId ? `m${p.methodId}` : p.methodType} onChange={(e) => { const v = e.target.value; const m = (methods.data?.data || []).find((x: any) => `m${x.id}` === v); setPays(pays.map((x, j) => j === i ? { ...x, methodType: m ? (m.type === 'cash' ? 'cash' : m.type === 'card' ? 'card' : m.type === 'wallet' ? 'wallet' : 'bank') : v as any, methodId: m?.id ?? null } : x)); }}>
                <option value="cash">Cash</option><option value="card">Card terminal</option>{(methods.data?.data || []).filter((m: any) => m.enabled && m.type !== 'cash').map((m: any) => <option key={m.id} value={`m${m.id}`}>{m.label}</option>)}
              </select>
              <input className="input grow" type="number" min="0" step="0.01" value={p.amount} onChange={(e) => setPays(pays.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} aria-label="Amount" />
              {pays.length > 1 && <button className="btn btn-ghost icon-btn" onClick={() => setPays(pays.filter((_, j) => j !== i))} aria-label="Remove payment"><Trash2 size={15} /></button>}
            </div>
          ))}
          <div className="row"><button className="btn btn-sm" onClick={() => setPays([...pays, { methodType: 'card', amount: Math.max(0, total - paid).toFixed(2) }])}>+ Split payment</button>
            <button className="btn btn-sm" onClick={() => { const n = Number(prompt('Split equally between how many people?', '2')); if (n >= 2 && n <= 50) { const each = Math.floor((total / n) * 100) / 100; setPays(Array.from({ length: n }, (_, i) => ({ methodType: 'cash', amount: (i === n - 1 ? total - each * (n - 1) : each).toFixed(2) }))); } }}>Split equally</button></div>
          {pays.some((p) => p.methodType === 'cash') && <label className="field">Cash tendered<input className="input" type="number" min="0" step="0.01" value={tendered} onChange={(e) => setTendered(e.target.value)} /></label>}
          <div className="row-between small"><span>Paying now</span><strong>{money(paid, cur)}</strong></div>
          {paid < total - 0.0001 && <div className="alert alert-warning small">Partial payment — the bill stays open with {money(total - paid, cur)} due.</div>}
          {paid > total + 0.0001 && <div className="error-text">Payments exceed the total. Use “cash tendered” for change.</div>}
          {tendered && <div className="row-between"><span>Change</span><strong>{money(Math.max(0, Number(tendered) - pays.filter((p) => p.methodType === 'cash').reduce((a, p) => a + Number(p.amount), 0)), cur)}</strong></div>}
          <button className="btn btn-primary btn-lg" disabled={busy || paid > total + 0.0001} onClick={() => sale(false)}>Complete sale</button>
        </div>
      </Modal>

      <Modal open={!!result} title={result?.held ? 'Order held' : 'Sale complete'} onClose={() => setResult(null)}>
        {result && <div className="stack">
          <div>Order <strong>{result.orderNo}</strong> · Bill {result.bill.bill_no}</div>
          {!result.held && <><div className="row-between"><span>Total</span><strong>{money(result.bill.total, cur)}</strong></div><div className="row-between"><span>Paid</span><span>{money(result.bill.paid_total, cur)}</span></div>{Number(result.change) > 0 && <div className="row-between" style={{ fontSize: 18 }}><span>Change due</span><strong>{money(result.change, cur)}</strong></div>}</>}
          {!result.held && <button className="btn btn-primary" onClick={async () => { try { await printReceipt(result.bill.id, printer, { openDrawer: pays.some((p) => p.methodType === 'cash') }); toast('Printed'); } catch (e: any) { toast(e.message, 'error'); } }}><PrinterIcon size={16} /> Print receipt</button>}
          <button className="btn" onClick={() => setResult(null)}>New sale</button>
        </div>}
      </Modal>

      <Drawer open={showHeld} title="Held orders" onClose={() => setShowHeld(false)}>
        {(held.data?.data || []).length === 0 ? <div className="empty">No held orders</div> : held.data.data.map((h: any) => (
          <div key={h.id} className="card card-tight mb"><div className="row-between"><strong>{h.order_no}</strong><span>{money(h.subtotal, cur)}</span></div><div className="small muted">{h.customer_name || 'Walk-in'} · {h.items.map((i: any) => `${i.quantity}× ${i.name}`).join(', ')}</div>
            <div className="row mt-s"><button className="btn btn-sm btn-primary" onClick={async () => { await run(() => api(`/r/pos/held/${h.id}/resume`, { body: {} }), 'Sent to kitchen — collect payment from Bills'); held.reload(); }}>Resume & send</button>
              <button className="btn btn-sm" onClick={async () => { await run(() => api(`/r/pos/held/${h.id}`, { method: 'DELETE' }), 'Discarded'); held.reload(); }}>Discard</button>
              <a className="btn btn-sm btn-ghost" href={`/dashboard/bills/${h.bill_id}`}>Bill</a></div></div>
        ))}
      </Drawer>

      <Modal open={shiftModal === 'close'} title="Close shift" onClose={() => setShiftModal(null)}>
        {shift.data?.data && <div className="stack">
          <div className="small stack" style={{ gap: 3 }}>
            <div className="row-between"><span>Opening cash</span><span>{money(shift.data.data.opening_cash, cur)}</span></div>
            <div className="row-between"><span>Cash sales</span><span>{money(shift.data.data.cashSales, cur)}</span></div>
            <div className="row-between"><span>Cash refunds</span><span>-{money(shift.data.data.cashRefunds, cur)}</span></div>
            <div className="row-between"><span>Non-cash</span><span>{money(shift.data.data.nonCashSales, cur)}</span></div>
            <div className="row-between"><strong>Expected in drawer</strong><strong>{money(shift.data.data.expectedCash, cur)}</strong></div>
          </div>
          <label className="field">Counted cash<input className="input" type="number" min="0" step="0.01" value={cash} onChange={(e) => setCash(e.target.value)} /></label>
          {cash !== '' && <div className="small">Difference: <strong>{money(Number(cash) - Number(shift.data.data.expectedCash), cur)}</strong></div>}
          <button className="btn btn-primary" disabled={busy || cash === ''} onClick={async () => { const r = await run(() => api('/r/pos/shift/close', { body: { countedCash: cash } }), 'Shift closed'); if (r) { setShiftModal(null); setCash(''); shift.reload(); } }}>Close shift</button>
        </div>}
      </Modal>
    </div>
  );
}
