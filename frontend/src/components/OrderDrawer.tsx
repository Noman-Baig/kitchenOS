'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, idemKey } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { dt, money, titleCase } from '@/lib/format';
import { useSession } from '@/components/Session';
import { ConfirmButton, Drawer, Status, useAction } from '@/components/ui';
import { ItemOptions, MenuGrid, toApiLines, type CartLine } from '@/components/MenuPicker';

export function OrderDrawer({ id, onClose, onChanged }: { id: number | null; onClose: () => void; onChanged: () => void }) {
  const s = useSession();
  const { data, reload } = useApi<any>(id ? `/r/orders/${id}` : null);
  const [run, busy] = useAction();
  const [adding, setAdding] = useState(false);
  const menu = useApi<any>(adding ? '/r/menu' : null);
  const [pick, setPick] = useState<any>(null);
  const [lines, setLines] = useState<CartLine[]>([]);
  const o = data?.data;
  const act = async (status: string, reason?: string) => { const ok = await run(() => api(`/r/orders/${id}/status`, { body: { status, reason } }), `Order ${titleCase(status)}`); if (ok) { reload(); onChanged(); } };
  return (
    <Drawer open={!!id} title={o ? `Order ${o.order_no}` : 'Order'} onClose={() => { setAdding(false); setLines([]); onClose(); }}
      footer={o && <>
        {['pending_approval', 'submitted'].includes(o.status) && s.can('orders.manage') && <><ConfirmButton label="Reject" confirm="Reject this order?" reason="Reason shown to the customer" onConfirm={(r) => act('rejected', r)} className="btn" /><button className="btn btn-primary" disabled={busy} onClick={() => act('accepted')}>Accept</button></>}
        {['accepted', 'preparing'].includes(o.status) && s.can('kitchen.update') && <button className="btn" disabled={busy} onClick={() => act('ready')}>Mark ready</button>}
        {o.status === 'ready' && <button className="btn btn-primary" disabled={busy} onClick={() => act('served')}>Mark served</button>}
        {!['completed', 'cancelled', 'rejected'].includes(o.status) && s.can('orders.manage') && <ConfirmButton label="Cancel order" confirm="Cancel the whole order? Stock will be returned." reason="Reason" onConfirm={(r) => act('cancelled', r)} className="btn" />}
      </>}>
      {!o ? <div className="skeleton" /> : <div className="stack">
        <div className="row"><Status value={o.status} /><span className="badge">{titleCase(o.channel)}</span><span className="badge">{titleCase(o.order_type)}</span>{o.is_addition ? <span className="badge badge-info">Addition</span> : null}</div>
        <div className="small muted">{o.table_name ? `${o.table_name} · ` : ''}{o.customer_name || 'Guest'}{o.customer_phone ? ` · ${o.customer_phone}` : ''} · {dt(o.created_at, s.tz)}</div>
        {o.delivery_address && <div className="alert small"><strong>Delivery:</strong> {o.delivery_address}{o.delivery_instructions ? ` — ${o.delivery_instructions}` : ''}</div>}
        {o.notes && <div className="alert small"><strong>Note:</strong> {o.notes}</div>}
        <div className="table-wrap"><table className="table"><tbody>{o.items.map((i: any) => (
          <tr key={i.id}><td><strong>{i.quantity}×</strong> {i.name}{i.variant_name ? ` (${i.variant_name})` : ''}{i.addons.length ? <div className="tiny muted">+ {i.addons.map((a: any) => a.name).join(', ')}</div> : null}{i.notes && <div className="tiny muted">“{i.notes}”</div>}</td>
            <td><Status value={i.status} />{i.is_complimentary ? <span className="badge badge-brand" style={{ marginLeft: 4 }}>Comp</span> : null}</td>
            <td className="num">{money(i.line_total, s.currency)}</td>
            <td className="right nowrap">{i.status !== 'cancelled' && s.can('orders.manage') && <ConfirmButton label="Void" confirm={`Remove ${i.name} from the order?`} reason="Reason" onConfirm={async (r) => { await run(() => api(`/r/order-items/${i.id}/cancel`, { body: { reason: r } }), 'Item removed'); reload(); onChanged(); }} className="btn btn-sm btn-ghost" />}
              {!i.is_complimentary && !i.stock_deducted && i.status !== 'cancelled' && s.can('discounts.apply') && <ConfirmButton danger={false} label="Comp" confirm={`Make ${i.name} complimentary?`} reason="Reason" onConfirm={async (r) => { await run(() => api(`/r/order-items/${i.id}/complimentary`, { body: { reason: r } }), 'Marked complimentary'); reload(); }} className="btn btn-sm btn-ghost" />}</td></tr>
        ))}</tbody></table></div>
        <div className="row-between"><Link className="link small" href={`/dashboard/bills/${o.bill_id}`}>Open bill</Link>{s.can('orders.create') && !['completed', 'cancelled', 'rejected'].includes(o.status) && <button className="btn btn-sm" onClick={() => setAdding(!adding)}>{adding ? 'Close menu' : 'Add items'}</button>}</div>
        {adding && <div className="card card-tight">
          <MenuGrid menu={menu.data?.data} currency={s.currency} onPick={setPick} />
          {lines.length > 0 && <div className="mt">{lines.map((l) => <div key={l.key} className="row-between small"><span>{l.quantity}× {l.name}{l.variantName ? ` (${l.variantName})` : ''}</span><button className="btn btn-sm btn-ghost" onClick={() => setLines(lines.filter((x) => x.key !== l.key))}>Remove</button></div>)}
            <button className="btn btn-primary btn-block mt-s" disabled={busy} onClick={async () => { const ok = await run(() => api(`/r/orders/${id}/additions`, { body: { lines: toApiLines(lines), idempotencyKey: idemKey() } }), 'Items added'); if (ok) { setLines([]); setAdding(false); onChanged(); } }}>Send {lines.length} addition(s)</button></div>}
        </div>}
        {pick && <ItemOptions item={pick} currency={s.currency} allowComp={s.can('discounts.apply')} onAdd={(l) => setLines([...lines, l])} onClose={() => setPick(null)} />}
        <div className="section-title">History</div>
        <div className="stack" style={{ gap: 4 }}>{o.events.map((e: any) => <div key={e.id} className="small"><span className="mono tiny muted">{dt(e.created_at, s.tz, { timeStyle: 'medium' })}</span> {titleCase(e.event.replace(':', ' '))} <span className="muted">({e.actor_type}){e.data?.reason ? ` — ${e.data.reason}` : ''}</span></div>)}</div>
      </div>}
    </Drawer>
  );
}

