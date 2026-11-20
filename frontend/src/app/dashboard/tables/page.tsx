'use client';
import { useState } from 'react';
import { Download, QrCode, RefreshCw, Wifi } from 'lucide-react';
import { api, apiUrl, download } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { useStaffEvents } from '@/lib/socket';
import { money } from '@/lib/format';
import { useSession } from '@/components/Session';
import { ResourcePage, useOptions } from '@/components/ResourcePage';
import { ConfirmButton, Modal, useAction } from '@/components/ui';

function QrModal({ table, onClose }: { table: any; onClose: () => void }) {
  const [v, setV] = useState(0);
  const [run] = useAction();
  const info = useApi<any>(table ? `/r/tables/${table.id}/qr?format=json&v=${v}` : null);
  if (!table) return null;
  return (
    <Modal open title={`QR — ${table.name}`} onClose={onClose}>
      <div className="stack" style={{ alignItems: 'center' }}>
        <img src={apiUrl(`/r/tables/${table.id}/qr?v=${v}`)} alt={`QR code for ${table.name}`} width={240} height={240} style={{ background: '#fff', borderRadius: 8 }} />
        <div className="tiny muted mono" style={{ wordBreak: 'break-all' }}>{info.data?.data.url}</div>
        <div className="row">
          <button className="btn" onClick={() => download(`/r/tables/${table.id}/qr?format=png`, `qr-${table.table_number}.png`)}><Download size={15} /> PNG</button>
          <button className="btn" onClick={() => { const w = window.open('', '_blank'); if (w) { w.document.write(`<html><body style="text-align:center;font-family:sans-serif;padding:24px"><h2>${table.name}</h2><img src="${apiUrl(`/r/tables/${table.id}/qr?v=${v}`)}" width="320"><p>Scan to view the menu and order</p><script>onload=()=>print()</script></body></html>`); w.document.close(); } }}>Print</button>
          <ConfirmButton label={<><RefreshCw size={15} /> Regenerate</>} confirm="The current printed QR will stop working immediately. Continue?" onConfirm={async () => { await run(() => api(`/r/tables/${table.id}/qr/regenerate`, { body: {} }), 'New QR generated; old QR revoked'); setV(v + 1); }} className="btn" />
          <ConfirmButton label="Block" confirm="Disable this table's QR code? Guests will not be able to order until you regenerate it." onConfirm={async () => { await run(() => api(`/r/tables/${table.id}/qr/block`, { body: {} }), 'QR blocked'); onClose(); }} className="btn" />
        </div>
      </div>
    </Modal>
  );
}

export default function Tables() {
  const s = useSession();
  const branches = useOptions('/r/branches');
  const staff = useApi<any>('/r/staff');
  const overview = useApi<any>('/r/tables-overview');
  const [qr, setQr] = useState<any>(null);
  const [extra, setExtra] = useState<'online' | 'wifi' | null>(null);
  const [run] = useAction();
  useStaffEvents({ 'table:session': overview.reload, 'order:new': overview.reload, 'bill:updated': overview.reload }, overview.reload);
  const ov = (id: number) => (overview.data?.data || []).find((t: any) => t.id === id);
  return (
    <div className="page">
      <ResourcePage title="Tables" subtitle="Each table has a secure QR code. Regenerating revokes the old code." endpoint="/r/tables" canWrite={s.can('tables.manage')}
        toolbar={<><button className="btn" onClick={() => setExtra('online')}><QrCode size={15} /> Online ordering QR</button><button className="btn" onClick={() => setExtra('wifi')}><Wifi size={15} /> Wi-Fi QR</button></>}
        fields={[
          { name: 'name', label: 'Name', required: true, placeholder: 'Table 1' }, { name: 'table_number', label: 'Number', required: true },
          { name: 'capacity', label: 'Capacity', type: 'number', required: true }, { name: 'area', label: 'Area', placeholder: 'Terrace', nullable: true },
          { name: 'branch_id', label: 'Branch', type: 'select', options: branches, nullable: true },
          { name: 'waiter_user_id', label: 'Assigned waiter', type: 'select', nullable: true, options: () => (staff.data?.data || []).filter((u: any) => u.active).map((u: any) => ({ value: u.id, label: u.name })) },
          { name: 'active', label: 'Enabled', type: 'checkbox' },
        ]}
        defaults={{ capacity: 4, active: true }}
        columns={[
          { key: 'name', label: 'Table', render: (r) => <strong>{r.name}</strong> }, { key: 'table_number', label: 'No.' }, { key: 'capacity', label: 'Seats' }, { key: 'area', label: 'Area', render: (r) => r.area || '—' },
          { key: 'state', label: 'Now', render: (r) => { const o = ov(r.id); return o?.session_id || o?.open_bill_id ? <span className="badge badge-info">Occupied{o.session_pin ? ` · PIN ${o.session_pin}` : ''}{o.open_bill_total ? ` · ${money(o.open_bill_total, s.currency)}` : ''}</span> : <span className="badge badge-success">Free</span>; } },
        ]}
        extraActions={(r, reload) => <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
          {s.can('tables.manage') && <button className="btn btn-sm" onClick={() => setQr(r)}><QrCode size={14} /> QR</button>}
          {ov(r.id)?.session_id && !ov(r.id)?.open_bill_id && s.can('orders.manage') && <button className="btn btn-sm btn-ghost" onClick={async () => { await run(() => api(`/r/tables/${r.id}/close-session`, { body: {} }), 'Table cleared'); overview.reload(); reload(); }}>Clear</button>}
        </div>}
      />
      <QrModal table={qr} onClose={() => setQr(null)} />
      <Modal open={!!extra} title={extra === 'wifi' ? 'Wi-Fi QR code' : 'Online ordering QR code'} onClose={() => setExtra(null)}>
        {extra && <div className="stack" style={{ alignItems: 'center' }}>
          <img src={apiUrl(extra === 'wifi' ? '/r/qr/wifi' : '/r/qr/online')} alt="QR code" width={240} height={240} style={{ background: '#fff', borderRadius: 8 }} onError={(e) => { (e.target as HTMLImageElement).alt = 'Configure Wi-Fi in Settings first'; }} />
          <p className="small muted" style={{ textAlign: 'center' }}>{extra === 'wifi' ? 'Joins your guest Wi-Fi. Phones handle Wi-Fi and websites separately, so place this next to the table ordering QR.' : 'For flyers, posters, business cards and social media. Opens your online ordering page (pickup/delivery).'}</p>
          <div className="row"><button className="btn" onClick={() => download(`${extra === 'wifi' ? '/r/qr/wifi' : '/r/qr/online'}?format=png`, `${extra}-qr.png`)}><Download size={15} /> PNG</button>
            {extra === 'online' && <ConfirmButton label="Regenerate" confirm="Printed online QR codes will stop working. Continue?" onConfirm={async () => { await run(() => api('/r/qr/online/regenerate', { body: {} }), 'Regenerated'); setExtra(null); }} className="btn" />}</div>
        </div>}
      </Modal>
    </div>
  );
}
