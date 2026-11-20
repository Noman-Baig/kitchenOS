'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { Bell, CreditCard, HelpCircle, MessageCircle, Phone, PhoneOff, Receipt, ShoppingBag, Star, Utensils } from 'lucide-react';
import { api, idemKey, setCustomerToken } from '@/lib/api';
import { customerSocket, dedupe } from '@/lib/socket';
import { money, titleCase, timeOnly } from '@/lib/format';
import { VoiceCall, webrtcSupported } from '@/lib/webrtc';
import { ItemOptions, toApiLines, type CartLine } from '../MenuPicker';
import { useToast } from '../ui';

const STEPS = ['pending_approval', 'accepted', 'preparing', 'ready', 'served'];

function Sheet({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: React.ReactNode; title: string }) {
  if (!open) return null;
  return <div className="sheet-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="sheet" role="dialog" aria-label={title}><div className="row-between mb"><h2 style={{ margin: 0 }}>{title}</h2><button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button></div>{children}</div></div>;
}

export function CustomerApp({ token, onEnded, greeting }: { token: string; onEnded: () => void; greeting?: string | null }) {
  const toast = useToast();
  const [state, setState] = useState<any>(null);
  const [menu, setMenu] = useState<any>(null);
  const [cat, setCat] = useState<number | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [pick, setPick] = useState<any>(null);
  const [view, setView] = useState<'menu' | 'orders' | 'bill'>('menu');
  const [cartOpen, setCartOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [msgs, setMsgs] = useState<any[]>([]);
  const [msg, setMsg] = useState('');
  const [mode, setMode] = useState<{ kind: 'new' } | { kind: 'edit'; orderId: string } | { kind: 'add'; orderId: string }>({ kind: 'new' });
  const [busy, setBusy] = useState(false);
  const [checkout, setCheckout] = useState({ address: '', instructions: '', pay: 'manual' as 'manual' | 'cash_on_delivery', notes: '' });
  const [payOpen, setPayOpen] = useState(false);
  const [payM, setPayM] = useState<any>(null);
  const [proof, setProof] = useState<File | null>(null);
  const [payRef, setPayRef] = useState('');
  const [fb, setFb] = useState({ open: false, rating: 0, food: 0, service: 0, comment: '', publish: false });
  const [call, setCall] = useState<{ state: string; id?: string } | null>(null);
  const callRef = useRef<VoiceCall | null>(null);
  const sock = useRef<Socket | null>(null);
  const keyRef = useRef(idemKey());
  const [, tick] = useState(0);
  const [live, setLive] = useState(true);

  useEffect(() => { setCustomerToken(token); }, [token]);
  const load = useCallback(async () => {
    try { const r = await api('/public/session', { customer: true }); setState(r.data); }
    catch (e: any) { if (e.status === 401 || e.status === 402) onEnded(); }
  }, [onEnded]);
  const loadMenu = useCallback(async () => { try { const r = await api('/public/session/menu', { customer: true }); setMenu(r.data); } catch { /* */ } }, []);
  const loadChat = useCallback(async () => { try { const r = await api('/public/session/chat', { customer: true }); setMsgs(r.data); } catch { /* */ } }, []);
  useEffect(() => { setCustomerToken(token); void load(); void loadMenu(); }, [load, loadMenu, token]);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 15000); return () => clearInterval(t); }, []);

  useEffect(() => {
    const s = customerSocket(token); sock.current = s;
    const on = (ev: string, fn: (p: any) => void) => s.on(ev, (p: any) => { if (dedupe(p)) fn(p); });
    on('order:updated', (p) => { void load(); if (p.status === 'ready') toast('Your order is ready!'); if (p.status === 'accepted') toast('Order accepted'); if (p.status === 'rejected') toast('An order was not accepted — see Orders', 'error'); });
    on('order:new', () => void load()); on('order:edited', () => void load());
    on('bill:updated', () => void load());
    on('payment:rejected', (p) => { toast(`Payment rejected: ${p.reason}`, 'error'); void load(); });
    on('session:closed', () => { void load(); });
    on('menu:updated', () => void loadMenu());
    on('restaurant:ordering', () => void load());
    on('support:updated', (p) => { if (p.status === 'acknowledged') toast(`${p.by || 'Staff'} is on the way`); });
    on('chat:message', (m) => { setMsgs((x) => (x.some((y) => y.id === m.id) ? x : [...x, m])); if (m.sender_type === 'staff') toast('New message from staff'); });
    s.on('connect', () => { setLive(true); void load(); void loadChat(); });
    s.on('disconnect', () => setLive(false));
    // while the realtime link is down, resync state periodically so nothing is missed; stops once reconnected
    const resync = setInterval(() => { if (!s.connected) { setLive(false); void load(); } }, 10000);
    s.on('connect_error', (e) => { if (e.message === 'SESSION_INVALID' || e.message === 'RESTAURANT_UNAVAILABLE') void load(); });
    s.on('call:accepted', async () => { setCall({ state: 'connecting', id: callRef.current?.callId }); try { await callRef.current?.startAsCaller(); } catch { toast('Microphone permission is required for calls', 'error'); callRef.current?.hangup('mic_denied'); setCall(null); } });
    s.on('call:ended', (p) => { callRef.current?.close(); callRef.current = null; setCall(null); if (p.reason === 'missed') toast(`No one answered. ${p.fallbackPhone ? `Call ${p.fallbackPhone} or ` : ''}a staff member will come to you.`, 'error'); });
    return () => { clearInterval(resync); s.close(); callRef.current?.close(); };
  }, [token, load, loadMenu, loadChat, toast]);

  const r = state?.restaurant; const cur = r?.currency || 'USD';
  const bill = state?.bill;
  const orders = (bill?.orders || []).slice().reverse();
  const closed = state?.session?.status !== 'active';
  const cartTotal = cart.reduce((a, l) => a + l.unit * l.quantity, 0);
  const cats = menu?.categories || [];
  const shown = useMemo(() => (cat ? cats.filter((c: any) => c.id === cat) : cats), [cats, cat]);
  const online = state?.session?.kind === 'online';

  const submit = async () => {
    if (!cart.length) return;
    setBusy(true);
    try {
      if (mode.kind === 'edit') { await api(`/public/session/orders/${mode.orderId}`, { method: 'PATCH', body: { lines: toApiLines(cart) }, customer: true }); toast('Order updated'); }
      else if (mode.kind === 'add') { await api(`/public/session/orders/${mode.orderId}/additions`, { body: { lines: toApiLines(cart), idempotencyKey: keyRef.current }, customer: true }); toast('Additional items sent'); }
      else {
        await api('/public/session/orders', { body: { lines: toApiLines(cart), idempotencyKey: keyRef.current, notes: checkout.notes || null, deliveryAddress: online ? checkout.address || null : null, deliveryInstructions: online ? checkout.instructions || null : null, paymentPreference: online ? checkout.pay : undefined }, customer: true });
        toast(state.settings.approvalRequired ? 'Order sent — waiting for confirmation' : 'Order sent to the kitchen');
      }
      setCart([]); setCartOpen(false); setMode({ kind: 'new' }); keyRef.current = idemKey(); setView('orders'); await load();
    } catch (e: any) {
      if (e.details?.unavailable) { const names = e.details.unavailable.map((u: any) => u.name || `#${u.itemId}`); setCart(cart.filter((l) => !e.details.unavailable.some((u: any) => u.itemId === l.itemId))); toast(`No longer available: ${names.join(', ')}. Removed from your order.`, 'error'); void loadMenu(); }
      else if (e.details?.code === 'EDIT_WINDOW_CLOSED') { toast(e.message, 'error'); setMode({ kind: 'add', orderId: (mode as any).orderId }); }
      else toast(e.message, 'error');
    } finally { setBusy(false); }
  };
  const support = async (type: string, message?: string) => { try { const x = await api('/public/session/support', { body: { type, message }, customer: true }); toast(x.data.deduplicated ? 'Already requested — staff have been notified' : 'Staff have been notified'); setHelp(false); } catch (e: any) { toast(e.message, 'error'); } };
  const startCall = async () => {
    if (!webrtcSupported()) { toast('Calls are not supported in this browser', 'error'); return; }
    const ice = await api('/public/session/ice-servers', { customer: true }).catch(() => null);
    sock.current!.emit('call:start', {}, (res: any) => {
      if (!res?.ok) { toast(`${res?.error || 'Call failed'}${res?.fallbackPhone ? ` — call ${res.fallbackPhone}` : ''}`, 'error'); return; }
      callRef.current = new VoiceCall(sock.current!, res.callId, ice?.data?.iceServers || [{ urls: 'stun:stun.l.google.com:19302' }], (st) => setCall((c) => (c ? { ...c, state: st } : c)));
      setCall({ state: 'ringing', id: res.callId }); setHelp(false);
    });
  };
  const sendPayment = async () => {
    if (!payM || !proof) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append('methodId', String(payM.id)); fd.append('amount', Math.max(0, Number(bill.balance_due)).toFixed(4)); fd.append('idempotencyKey', idemKey()); if (payRef) fd.append('reference', payRef); fd.append('proof', proof);
      await api('/public/session/payments', { form: fd, customer: true }); toast('Payment submitted — staff will confirm shortly'); setPayOpen(false); setProof(null); setPayRef(''); await load();
    } catch (e: any) { toast(e.message, 'error'); } finally { setBusy(false); }
  };

  if (!state) return <div className="cust"><div style={{ padding: 30 }}><div className="skeleton" /></div></div>;
  const statusIdx = (st: string) => Math.max(0, STEPS.indexOf(st === 'submitted' ? 'pending_approval' : st));
  return (
    <div className="cust" style={{ ['--brand' as any]: r?.theme?.colors?.primary || undefined }}>
      <header className="cust-head">
        {r.logoUrl ? <img src={r.logoUrl} alt="" width={40} height={40} style={{ borderRadius: 10 }} /> : <span className="brand-logo" style={{ width: 40, height: 40 }}>{r.name[0]}</span>}
        <div className="grow"><strong>{r.name}</strong><div className="small muted">{state.table ? `${state.table.name} · ` : online ? `${titleCase(state.session.orderType)} · ` : ''}{state.session.name}{state.table && !closed ? ` · PIN ${state.session.pin}` : ''}</div></div>
        <div className="segmented"><button className={view === 'menu' ? 'active' : ''} onClick={() => setView('menu')} aria-label="Menu"><Utensils size={15} /></button><button className={view === 'orders' ? 'active' : ''} onClick={() => setView('orders')} aria-label="Orders"><ShoppingBag size={15} />{orders.length ? ` ${orders.length}` : ''}</button><button className={view === 'bill' ? 'active' : ''} onClick={() => setView('bill')} aria-label="Bill"><Receipt size={15} /></button></div>
      </header>
      {!live && <div className="tiny" style={{ textAlign: 'center', padding: 4, background: 'var(--surface-2)' }}>Reconnecting… your order status will update automatically</div>}
      {greeting && view === 'menu' && <div className="alert alert-success" style={{ margin: 12 }}>{greeting}</div>}
      {closed && <div className="alert" style={{ margin: 12 }}><strong>Thank you!</strong> This {online ? 'order' : 'table session'} is closed{bill?.payment_status === 'paid' ? ' and your bill is settled' : ''}. {state.table && <button className="btn btn-sm btn-primary" style={{ marginLeft: 6 }} onClick={onEnded}>Start a new order</button>}</div>}
      {mode.kind !== 'new' && <div className="alert alert-warning row-between" style={{ margin: 12 }}>{mode.kind === 'edit' ? 'Editing your order' : 'Adding items to your order'}<button className="btn btn-sm" onClick={() => { setMode({ kind: 'new' }); setCart([]); }}>Cancel</button></div>}

      {view === 'menu' && <>
        <div className="cust-cats"><button className={`chip ${cat === null ? 'active' : ''}`} onClick={() => setCat(null)}>All</button>{cats.map((c: any) => <button key={c.id} className={`chip ${cat === c.id ? 'active' : ''}`} onClick={() => setCat(c.id)}>{c.name}</button>)}</div>
        {!menu ? <div style={{ padding: 20 }}><div className="skeleton" /></div> : shown.map((c: any) => (
          <section key={c.id}><h3 style={{ padding: '14px 16px 6px', margin: 0 }}>{c.name}</h3>
            {c.items.map((i: any) => (
              <div key={i.id} className="menu-item" role="button" tabIndex={0} aria-disabled={!i.available || closed} onClick={() => i.available && !closed && setPick(i)} onKeyDown={(e) => e.key === 'Enter' && i.available && !closed && setPick(i)} style={{ opacity: i.available ? 1 : 0.5 }}>
                <div className="grow"><div className="name">{i.name}{i.featured ? ' ★' : ''}</div><div className="desc">{i.description}</div><div className="row mt-s" style={{ gap: 8 }}><strong>{money(i.price, cur)}</strong>{i.prepMinutes ? <span className="tiny muted">~{i.prepMinutes} min</span> : null}{!i.available && <span className="badge">Unavailable</span>}{i.allergens && <span className="tiny muted">⚠ {i.allergens}</span>}</div></div>
                {i.thumbUrl && <img src={i.thumbUrl} alt="" loading="lazy" />}
              </div>))}
          </section>))}
      </>}

      {view === 'orders' && <div style={{ padding: 12 }} className="stack">
        {orders.length === 0 && <div className="empty">No orders yet</div>}
        {orders.map((o: any) => {
          const canEdit = o.editable_until && new Date(o.editable_until).getTime() > Date.now() && ['pending_approval', 'accepted'].includes(o.status) && !closed;
          const eta = o.accepted_at && o.prep_estimate_minutes ? new Date(new Date(o.accepted_at).getTime() + o.prep_estimate_minutes * 60000) : null;
          return (
            <div key={o.id} className="card">
              <div className="row-between"><strong>Order {o.order_no}{o.is_addition ? ' · extra' : ''}</strong><span className={`badge ${['rejected', 'cancelled'].includes(o.status) ? 'badge-danger' : o.status === 'ready' ? 'badge-success' : 'badge-info'}`}>{o.status === 'pending_approval' ? 'Waiting for confirmation' : titleCase(o.status)}</span></div>
              {!['rejected', 'cancelled', 'completed'].includes(o.status) && <div className="status-steps">{STEPS.map((st, i) => <div key={st} className={`step ${i <= statusIdx(o.status) ? 'done' : ''}`} />)}</div>}
              {eta && ['accepted', 'preparing'].includes(o.status) && <div className="small muted">Estimated ready around {timeOnly(eta, r.timezone)} (depends on kitchen workload)</div>}
              <div className="small mt-s">{o.items.filter((i: any) => i.status !== 'cancelled').map((i: any) => <div key={i.id}>{i.quantity}× {i.name}{i.variant_name ? ` (${i.variant_name})` : ''}</div>)}</div>
              {!closed && !['rejected', 'cancelled', 'completed'].includes(o.status) && <div className="row mt-s">
                {canEdit && <button className="btn btn-sm" onClick={() => { setMode({ kind: 'edit', orderId: o.public_id }); setCart(o.items.filter((i: any) => i.status !== 'cancelled').map((i: any, k: number) => ({ key: `${i.id}-${k}`, itemId: i.menu_item_id, name: i.name, variantId: i.variant_id ?? null, variantName: i.variant_name, addonIds: (i.addons || []).map((a: any) => a.id), addonNames: (i.addons || []).map((a: any) => a.name), unit: Number(i.unit_price) + Number(i.addons_total), quantity: i.quantity, notes: i.notes || undefined }))); setView('menu'); toast(`You can edit until ${timeOnly(o.editable_until, r.timezone)}`); }}>Edit order</button>}
                <button className="btn btn-sm" onClick={() => { setMode({ kind: 'add', orderId: o.public_id }); setCart([]); setView('menu'); }}>Add more items</button>
              </div>}
            </div>);
        })}
        {!closed && <button className="btn btn-block" onClick={() => setView('menu')}>Back to menu</button>}
      </div>}

      {view === 'bill' && <div style={{ padding: 12 }} className="stack">
        {!bill ? <div className="empty">Your bill will appear here after you order.</div> : <>
          <div className="card stack" style={{ gap: 4 }}>
            {bill.orders.filter((o: any) => !['rejected', 'cancelled'].includes(o.status)).flatMap((o: any) => o.items.filter((i: any) => i.status !== 'cancelled')).map((i: any) => <div key={i.id} className="row-between small"><span>{i.quantity}× {i.name}{i.is_complimentary ? ' (complimentary)' : ''}</span><span>{money(i.line_total, cur)}</span></div>)}
            <hr style={{ margin: '8px 0' }} />
            <div className="row-between small"><span>Subtotal</span><span>{money(bill.subtotal, cur)}</span></div>
            {Number(bill.discount_total) > 0 && <div className="row-between small"><span>Discount</span><span>-{money(bill.discount_total, cur)}</span></div>}
            {bill.taxes.map((t: any) => <div key={t.tax_id} className="row-between small muted"><span>{t.name} ({Number(t.rate)}%{t.inclusive ? ', included' : ''})</span><span>{money(t.amount, cur)}</span></div>)}
            {Number(bill.delivery_charge) > 0 && <div className="row-between small"><span>Delivery</span><span>{money(bill.delivery_charge, cur)}</span></div>}
            <div className="row-between" style={{ fontWeight: 700, fontSize: 18 }}><span>Total</span><span>{money(bill.total, cur)}</span></div>
            {Number(bill.paid_total) > 0 && <div className="row-between small"><span>Paid</span><span>{money(bill.paid_total, cur)}</span></div>}
            <div className="row-between"><span>Balance</span><strong>{money(Math.max(0, Number(bill.balance_due)), cur)}</strong></div>
            <div className="small"><span className={`badge ${bill.payment_status === 'paid' ? 'badge-success' : 'badge-warning'}`}>{bill.payment_status === 'under_review' ? 'Payment under review' : titleCase(bill.payment_status)}</span></div>
          </div>
          {bill.payments.filter((p: any) => p.status === 'rejected').map((p: any) => <div key={p.id} className="alert alert-danger small">A payment of {money(p.amount, cur)} was rejected: {p.rejection_reason}</div>)}
          {!closed && Number(bill.balance_due) > 0 && <div className="stack">
            {state.paymentMethods.filter((m: any) => m.type !== 'cash').length > 0 && <button className="btn btn-primary btn-lg" onClick={() => { setPayM(state.paymentMethods.find((m: any) => m.type !== 'cash')); setPayOpen(true); }}><CreditCard size={17} /> Pay by transfer</button>}
            <button className="btn btn-lg" onClick={async () => { try { await api('/public/session/cash-request', { body: {}, customer: true }); toast('A staff member will come to collect cash'); await load(); } catch (e: any) { toast(e.message, 'error'); } }}>Pay cash to staff</button>
            <button className="btn" onClick={() => support('billing')}>Ask for billing help</button>
          </div>}
          {orders.some((o: any) => ['served', 'completed'].includes(o.status)) && !state.feedbackSubmitted && <button className="btn" onClick={() => setFb({ ...fb, open: true })}><Star size={15} /> Rate your experience</button>}
        </>}
      </div>}

      {!closed && <button className="fab" onClick={() => setHelp(true)} aria-label="Help and support"><HelpCircle size={22} /></button>}
      {cart.length > 0 && <div className="cart-bar"><button className="btn btn-primary btn-lg btn-block" onClick={() => setCartOpen(true)}>{mode.kind === 'edit' ? 'Review changes' : mode.kind === 'add' ? 'Review additions' : 'View order'} · {cart.reduce((a, l) => a + l.quantity, 0)} items · {money(cartTotal, cur)}</button></div>}
      {call && <div className="cart-bar" style={{ bottom: cart.length ? 76 : 14 }}><div className="card row-between"><span><Phone size={15} /> {call.state === 'ringing' ? 'Calling the restaurant…' : call.state}</span><button className="btn btn-danger btn-sm" onClick={() => { callRef.current?.hangup(); callRef.current = null; setCall(null); }}><PhoneOff size={15} /> End</button></div></div>}

      {pick && <ItemOptions item={pick} currency={cur} onAdd={(l) => { setCart([...cart, l]); toast(`${l.name} added`); }} onClose={() => setPick(null)} />}

      <Sheet open={cartOpen} onClose={() => setCartOpen(false)} title={mode.kind === 'edit' ? 'Edit order' : mode.kind === 'add' ? 'Additional items' : 'Your order'}>
        <div className="stack">
          {cart.map((l) => <div key={l.key} className="row-between"><div className="grow"><div style={{ fontWeight: 600 }}>{l.name}{l.variantName ? ` (${l.variantName})` : ''}</div><div className="tiny muted">{[...l.addonNames, l.notes].filter(Boolean).join(' · ')}</div></div>
            <div className="qty"><button onClick={() => setCart(cart.map((x) => x.key === l.key ? { ...x, quantity: x.quantity - 1 } : x).filter((x) => x.quantity > 0))} aria-label="Decrease">−</button><span>{l.quantity}</span><button onClick={() => setCart(cart.map((x) => x.key === l.key ? { ...x, quantity: Math.min(99, x.quantity + 1) } : x))} aria-label="Increase">+</button></div>
            <span style={{ width: 80, textAlign: 'right' }}>{money(l.unit * l.quantity, cur)}</span></div>)}
          {mode.kind === 'new' && <label className="field">Note for the kitchen<input className="input" value={checkout.notes} onChange={(e) => setCheckout({ ...checkout, notes: e.target.value })} maxLength={500} /></label>}
          {online && mode.kind === 'new' && <>
            {state.session.orderType === 'delivery' && <><label className="field">Delivery address *<textarea className="input" value={checkout.address} onChange={(e) => setCheckout({ ...checkout, address: e.target.value })} /></label><label className="field">Delivery instructions<input className="input" value={checkout.instructions} onChange={(e) => setCheckout({ ...checkout, instructions: e.target.value })} /></label></>}
            <div className="field">Payment<div className="segmented"><button className={checkout.pay === 'manual' ? 'active' : ''} onClick={() => setCheckout({ ...checkout, pay: 'manual' })}>Transfer (upload proof)</button>{r.ordering.cashOnDelivery && <button className={checkout.pay === 'cash_on_delivery' ? 'active' : ''} onClick={() => setCheckout({ ...checkout, pay: 'cash_on_delivery' })}>Cash on {state.session.orderType === 'delivery' ? 'delivery' : 'pickup'}</button>}</div></div>
            {Number(r.ordering.minimumOrder) > 0 && <div className="tiny muted">Minimum order {money(r.ordering.minimumOrder, cur)}{state.session.orderType === 'delivery' && Number(r.ordering.deliveryCharge) > 0 ? ` · delivery charge ${money(r.ordering.deliveryCharge, cur)}` : ''}</div>}
          </>}
          <div className="row-between"><span className="muted small">Taxes are shown on your bill</span><strong>{money(cartTotal, cur)}</strong></div>
          <button className="btn btn-primary btn-lg" disabled={busy || !cart.length || (online && state.session.orderType === 'delivery' && mode.kind === 'new' && !checkout.address)} onClick={submit}>{busy ? 'Sending…' : mode.kind === 'edit' ? 'Update order' : mode.kind === 'add' ? 'Send additional items' : 'Send order'}</button>
        </div>
      </Sheet>

      <Sheet open={help} onClose={() => setHelp(false)} title="How can we help?">
        <div className="grid grid-2">
          <button className="btn btn-lg" onClick={() => support('waiter')}><Bell size={17} /> Call waiter</button>
          <button className="btn btn-lg" onClick={() => { setHelp(false); setChatOpen(true); void loadChat(); }}><MessageCircle size={17} /> Chat</button>
          <button className="btn btn-lg" onClick={startCall}><Phone size={17} /> Voice call</button>
          <button className="btn btn-lg" onClick={() => support('billing')}><Receipt size={17} /> Billing help</button>
          <button className="btn btn-lg" onClick={() => support('order')}>Order question</button>
          <button className="btn btn-lg" onClick={() => support('general')}>General inquiry</button>
        </div>
        {state.settings.fallbackPhone && <p className="small muted mt">Or call us: <a className="link" href={`tel:${state.settings.fallbackPhone}`}>{state.settings.fallbackPhone}</a></p>}
      </Sheet>

      <Sheet open={chatOpen} onClose={() => setChatOpen(false)} title="Chat with staff">
        <div className="chat">{msgs.length === 0 && <div className="small muted">Send a message and a staff member will reply here.</div>}{msgs.map((m) => <div key={m.id} className={`bubble ${m.sender_type === 'customer' ? 'me' : 'them'}`}>{m.body}</div>)}</div>
        <form className="row mt" onSubmit={async (e) => { e.preventDefault(); if (!msg.trim()) return; try { const x = await api('/public/session/chat', { body: { body: msg }, customer: true }); setMsgs((y) => (y.some((z) => z.id === x.data.id) ? y : [...y, x.data])); setMsg(''); } catch (er: any) { toast(er.message, 'error'); } }}><input className="input grow" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Type a message" maxLength={2000} aria-label="Message" /><button className="btn btn-primary">Send</button></form>
      </Sheet>

      <Sheet open={payOpen} onClose={() => setPayOpen(false)} title="Pay by transfer">
        <div className="stack">
          <div className="row" style={{ flexWrap: 'wrap' }}>{state.paymentMethods.filter((m: any) => m.type !== 'cash').map((m: any) => <button key={m.id} className={`chip ${payM?.id === m.id ? 'active' : ''}`} onClick={() => setPayM(m)}>{m.label}</button>)}</div>
          {payM && <div className="alert small"><strong>{payM.bank_name || payM.label}</strong>{payM.account_title && <div>{payM.account_title}</div>}{payM.account_number && <div className="mono">{payM.account_number}</div>}{payM.iban && <div className="mono">IBAN {payM.iban}</div>}{payM.instructions && <div className="muted">{payM.instructions}</div>}{payM.qrUrl && <img src={payM.qrUrl} alt="Payment QR" style={{ width: 180, marginTop: 8 }} />}</div>}
          <div className="row-between"><span>Amount to pay</span><strong>{money(Math.max(0, Number(bill?.balance_due || 0)), cur)}</strong></div>
          <label className="field">Transaction reference (optional)<input className="input" value={payRef} onChange={(e) => setPayRef(e.target.value)} /></label>
          <label className="field">Payment screenshot *<input className="input" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setProof(e.target.files?.[0] || null)} style={{ paddingTop: 6 }} /></label>
          <p className="tiny muted" style={{ margin: 0 }}>Your payment is confirmed only after staff verify it.</p>
          <button className="btn btn-primary btn-lg" disabled={busy || !payM || !proof} onClick={sendPayment}>Submit payment</button>
        </div>
      </Sheet>

      <Sheet open={fb.open} onClose={() => setFb({ ...fb, open: false })} title="Rate your experience">
        <div className="stack">
          {([['rating', 'Overall'], ['food', 'Food'], ['service', 'Service']] as const).map(([k, l]) => <div key={k} className="row-between"><span>{l}</span><span>{[1, 2, 3, 4, 5].map((n) => <button key={n} className="btn btn-ghost btn-sm" style={{ padding: '0 4px', fontSize: 22, color: (fb as any)[k] >= n ? 'var(--warning)' : 'var(--border-strong)' }} onClick={() => setFb({ ...fb, [k]: n })} aria-label={`${l} ${n} stars`}>★</button>)}</span></div>)}
          <textarea className="input" placeholder="Tell us more (optional)" value={fb.comment} onChange={(e) => setFb({ ...fb, comment: e.target.value })} />
          <label className="check"><input type="checkbox" checked={fb.publish} onChange={(e) => setFb({ ...fb, publish: e.target.checked })} /> The restaurant may show my comment and first name on its website</label>
          <button className="btn btn-primary" disabled={!fb.rating} onClick={async () => { try { await api('/public/session/feedback', { body: { rating: fb.rating, foodRating: fb.food || null, serviceRating: fb.service || null, comment: fb.comment || null, isComplaint: fb.rating <= 2, publishPermission: fb.publish }, customer: true }); toast('Thank you for your feedback!'); setFb({ ...fb, open: false }); await load(); } catch (e: any) { toast(e.message, 'error'); } }}>Submit</button>
        </div>
      </Sheet>
    </div>
  );
}
