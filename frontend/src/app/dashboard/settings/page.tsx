'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useSession } from '@/components/Session';
import { PageHead, Skeleton, Tabs, useAction } from '@/components/ui';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function Settings() {
  const s = useSession();
  const { data, reload } = useApi<any>('/r/settings');
  const staff = useApi<any>('/r/staff');
  const [tab, setTab] = useState<'general' | 'ordering' | 'online' | 'loyalty' | 'calls' | 'security'>('general');
  const [f, setF] = useState<any>(null);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [run, busy] = useAction();
  useEffect(() => { if (data) setF(data.data); }, [data]);
  if (!f) return <div className="page"><Skeleton rows={8} /></div>;
  const st = f.settings;
  const set = (k: string, v: any) => setF({ ...f, settings: { ...st, [k]: v } });
  const save = async () => {
    const { name, legalName, address, city, timezone, locale, contactEmail, contactPhone, wifiSsid, wifiPassword, wifiEncryption, settings } = f;
    const r = await run(() => api('/r/settings', { method: 'PATCH', body: { name, legalName: legalName || null, address: address || null, city: city || null, timezone, locale, contactEmail: contactEmail || null, contactPhone: contactPhone || null, wifiSsid: wifiSsid || null, wifiPassword: wifiPassword || null, wifiEncryption, settings } }), 'Settings saved');
    if (r) { reload(); s.reload(); }
  };
  const logo = async (file: File) => { const fd = new FormData(); fd.append('file', file); await run(() => api('/r/uploads/restaurant-logos', { form: fd }), 'Logo updated'); s.reload(); };
  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <PageHead title="Settings" actions={tab !== 'security' && <button className="btn btn-primary" disabled={busy} onClick={save}>Save changes</button>} />
      <Tabs value={tab} onChange={setTab} items={[{ value: 'general', label: 'General' }, { value: 'ordering', label: 'Ordering & kitchen' }, { value: 'online', label: 'Online & delivery' }, { value: 'loyalty', label: 'Loyalty' }, { value: 'calls', label: 'Calls & support' }, { value: 'security', label: 'My account' }]} />
      <div className="card">
        {tab === 'general' && <div className="form-grid">
          <div className="full row">{s.restaurant?.logoUrl ? <img src={s.restaurant.logoUrl} alt="" width={56} height={56} style={{ borderRadius: 10 }} /> : null}<label className="btn" style={{ cursor: 'pointer' }}>Upload logo<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && logo(e.target.files[0])} /></label><span className="tiny muted">Used on your website, receipts, invoices and reports.</span></div>
          <label className="field">Restaurant name<input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="field">Legal name<input className="input" value={f.legalName || ''} onChange={(e) => setF({ ...f, legalName: e.target.value })} /></label>
          <label className="field full">Address<input className="input" value={f.address || ''} onChange={(e) => setF({ ...f, address: e.target.value })} /></label>
          <label className="field">City<input className="input" value={f.city || ''} onChange={(e) => setF({ ...f, city: e.target.value })} /></label>
          <label className="field">Country<input className="input" value={f.country} disabled /></label>
          <label className="field">Currency<input className="input" value={f.currency} disabled /><span className="hint">Contact support to change currency.</span></label>
          <label className="field">Timezone<input className="input" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} /></label>
          <label className="field">Locale (number/date format)<input className="input" value={f.locale} onChange={(e) => setF({ ...f, locale: e.target.value })} placeholder="en, en-GB, ar-AE, ur-PK" /></label>
          <label className="field">Contact email<input className="input" type="email" value={f.contactEmail || ''} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} /></label>
          <label className="field">Contact phone<input className="input" value={f.contactPhone || ''} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} /></label>
          <label className="field">Public website<input className="input" value={`/r/${f.slug}`} disabled /></label>
          <div className="section-title full">Guest Wi-Fi (for the Wi-Fi QR code)</div>
          <label className="field">Network name (SSID)<input className="input" value={f.wifiSsid || ''} onChange={(e) => setF({ ...f, wifiSsid: e.target.value })} /></label>
          <label className="field">Password<input className="input" value={f.wifiPassword || ''} onChange={(e) => setF({ ...f, wifiPassword: e.target.value })} /></label>
          <label className="field">Security<select className="input" value={f.wifiEncryption} onChange={(e) => setF({ ...f, wifiEncryption: e.target.value })}><option value="WPA">WPA/WPA2</option><option value="WEP">WEP</option><option value="nopass">Open</option></select></label>
          <label className="field full">Receipt footer<input className="input" value={st.receiptFooter} onChange={(e) => set('receiptFooter', e.target.value)} /></label>
        </div>}
        {tab === 'ordering' && <div className="form-grid">
          <label className="check full"><input type="checkbox" checked={st.dineInOpen} onChange={(e) => set('dineInOpen', e.target.checked)} /> Accept dine-in QR orders</label>
          <label className="check full"><input type="checkbox" checked={st.orderApprovalRequired} onChange={(e) => set('orderApprovalRequired', e.target.checked)} /> Customer orders require staff approval before going to the kitchen</label>
          <label className="field">Customer edit window (minutes, 0 = disabled)<input className="input" type="number" min={0} max={120} value={st.editWindowMinutes} onChange={(e) => set('editWindowMinutes', Number(e.target.value))} /><span className="hint">After this, customers can only add new items.</span></label>
          <label className="field">Deduct stock when an order is<select className="input" value={st.stockDeductionTrigger} onChange={(e) => set('stockDeductionTrigger', e.target.value)}><option value="submitted">Submitted</option><option value="accepted">Accepted</option><option value="ready">Ready</option><option value="completed">Completed (bill closed)</option></select></label>
          <label className="check full"><input type="checkbox" checked={st.allowMultipleSessionsPerTable} onChange={(e) => set('allowMultipleSessionsPerTable', e.target.checked)} /> Allow separate parties on the same table (otherwise others join with the table PIN)</label>
          <label className="check full"><input type="checkbox" checked={st.returningCustomerGreeting} onChange={(e) => set('returningCustomerGreeting', e.target.checked)} /> Greet returning guests who opted in (“Welcome back…”)</label>
          <label className="field">Idle table session expiry (hours)<input className="input" type="number" min={1} max={48} value={st.sessionIdleHours} onChange={(e) => set('sessionIdleHours', Number(e.target.value))} /></label>
          <label className="field">Kitchen delay alert after (minutes)<input className="input" type="number" min={1} value={st.kdsDelayMinutes} onChange={(e) => set('kdsDelayMinutes', Number(e.target.value))} /></label>
          <label className="check full"><input type="checkbox" checked={st.kdsSound} onChange={(e) => set('kdsSound', e.target.checked)} /> Kitchen sound alerts on by default</label>
          <label className="field">Reservation seating buffer (minutes)<input className="input" type="number" min={0} value={st.reservationSeatingBufferMinutes} onChange={(e) => set('reservationSeatingBufferMinutes', Number(e.target.value))} /></label>
        </div>}
        {tab === 'online' && <div className="form-grid">
          <label className="check full"><input type="checkbox" checked={st.onlineOrderingOpen} onChange={(e) => set('onlineOrderingOpen', e.target.checked)} /> Online ordering open (turn off temporarily without affecting dine-in)</label>
          <label className="check"><input type="checkbox" checked={st.pickupEnabled} onChange={(e) => set('pickupEnabled', e.target.checked)} /> Pickup</label>
          <label className="check"><input type="checkbox" checked={st.deliveryEnabled} onChange={(e) => set('deliveryEnabled', e.target.checked)} /> Delivery</label>
          <label className="check"><input type="checkbox" checked={st.cashOnDeliveryEnabled} onChange={(e) => set('cashOnDeliveryEnabled', e.target.checked)} /> Cash on delivery</label>
          <label className="check"><input type="checkbox" checked={st.scheduledOrdersEnabled} onChange={(e) => set('scheduledOrdersEnabled', e.target.checked)} /> Scheduled orders</label>
          <label className="field">Delivery charge ({f.currency})<input className="input" type="number" min={0} step="0.01" value={st.deliveryCharge} onChange={(e) => set('deliveryCharge', e.target.value)} /></label>
          <label className="field">Minimum order ({f.currency})<input className="input" type="number" min={0} step="0.01" value={st.minimumOrderAmount} onChange={(e) => set('minimumOrderAmount', e.target.value)} /></label>
          <div className="section-title full">Opening hours</div>
          {st.openingHours.map((h: any, i: number) => <div key={i} className="row full"><select className="input" style={{ width: 100 }} value={h.day} onChange={(e) => set('openingHours', st.openingHours.map((x: any, j: number) => j === i ? { ...x, day: Number(e.target.value) } : x))}>{DAYS.map((d, k) => <option key={k} value={k}>{d}</option>)}</select><input className="input" style={{ width: 120 }} type="time" value={h.open} onChange={(e) => set('openingHours', st.openingHours.map((x: any, j: number) => j === i ? { ...x, open: e.target.value } : x))} /><input className="input" style={{ width: 120 }} type="time" value={h.close} onChange={(e) => set('openingHours', st.openingHours.map((x: any, j: number) => j === i ? { ...x, close: e.target.value } : x))} /><button className="btn btn-ghost" onClick={() => set('openingHours', st.openingHours.filter((_: any, j: number) => j !== i))}>Remove</button></div>)}
          <div className="full"><button className="btn" onClick={() => set('openingHours', [...st.openingHours, { day: 1, open: '09:00', close: '22:00' }])}>+ Add hours</button></div>
        </div>}
        {tab === 'loyalty' && <div className="form-grid">
          <label className="check full"><input type="checkbox" checked={st.loyalty.enabled} onChange={(e) => set('loyalty', { ...st.loyalty, enabled: e.target.checked })} /> Enable loyalty points</label>
          <label className="field">Points per 1 {f.currency} spent<input className="input" type="number" min={0} step="0.01" value={st.loyalty.pointsPerCurrencyUnit} onChange={(e) => set('loyalty', { ...st.loyalty, pointsPerCurrencyUnit: e.target.value })} /></label>
          <label className="field">Value of 1 point ({f.currency})<input className="input" type="number" min={0} step="0.0001" value={st.loyalty.redeemValuePerPoint} onChange={(e) => set('loyalty', { ...st.loyalty, redeemValuePerPoint: e.target.value })} /></label>
          <label className="field">Minimum points to redeem<input className="input" type="number" min={0} value={st.loyalty.minRedeemPoints} onChange={(e) => set('loyalty', { ...st.loyalty, minRedeemPoints: Number(e.target.value) })} /></label>
        </div>}
        {tab === 'calls' && <div className="form-grid">
          <div className="full small muted">Guests can start an in-browser voice call. Choose who rings. Staff need the “Receive customer calls” permission.</div>
          <div className="field full">Ring these roles<div className="row">{['owner', 'admin', 'manager', 'assistant_manager', 'waiter', 'cashier'].map((k) => <label key={k} className="check"><input type="checkbox" checked={st.callReceiverRoleKeys.includes(k)} onChange={(e) => set('callReceiverRoleKeys', e.target.checked ? [...st.callReceiverRoleKeys, k] : st.callReceiverRoleKeys.filter((x: string) => x !== k))} />{k.replace('_', ' ')}</label>)}</div></div>
          <div className="field full">…and these people<div className="row">{(staff.data?.data || []).map((u: any) => <label key={u.id} className="check"><input type="checkbox" checked={st.callReceiverUserIds.includes(u.id)} onChange={(e) => set('callReceiverUserIds', e.target.checked ? [...st.callReceiverUserIds, u.id] : st.callReceiverUserIds.filter((x: number) => x !== u.id))} />{u.name}</label>)}</div></div>
          <label className="field">Fallback phone (shown if a call cannot connect)<input className="input" value={st.fallbackPhone} onChange={(e) => set('fallbackPhone', e.target.value)} /></label>
        </div>}
        {tab === 'security' && <div className="stack" style={{ maxWidth: 420 }}>
          <h3>Change password</h3>
          <label className="field">Current password<input className="input" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></label>
          <label className="field">New password<input className="input" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /><span className="hint">Other sessions will be signed out.</span></label>
          <button className="btn btn-primary" disabled={busy || pw.newPassword.length < 10} onClick={async () => { const r = await run(() => api('/auth/change-password', { body: pw }), 'Password changed'); if (r) setPw({ currentPassword: '', newPassword: '' }); }}>Change password</button>
        </div>}
      </div>
    </div>
  );
}
