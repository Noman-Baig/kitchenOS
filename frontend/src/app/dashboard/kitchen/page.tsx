'use client';
import { useEffect, useState } from 'react';
import { Maximize2, Volume2, VolumeX } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi, useNow } from '@/lib/hooks';
import { beep, getStaffSocket, useStaffEvents } from '@/lib/socket';
import { ago, titleCase } from '@/lib/format';
import { Empty, PageHead, useAction } from '@/components/ui';

export default function Kitchen() {
  const stations = useApi<any>('/r/stations?pageSize=100');
  const [sel, setSel] = useState<number[]>([]);
  const [sound, setSound] = useState(true);
  const q = sel.length === 1 ? `?stationId=${sel[0]}` : '';
  const { data, reload } = useApi<any>(`/r/kitchen/tickets${q}`, { interval: 60000 });
  const now = useNow(10000);
  const [run] = useAction();
  useEffect(() => { try { setSel(JSON.parse(localStorage.getItem('um_kds_stations') || '[]')); } catch { /* */ } }, []);
  useEffect(() => { try { localStorage.setItem('um_kds_stations', JSON.stringify(sel)); } catch { /* */ } getStaffSocket().emit('kds:subscribe', sel); }, [sel]);
  useEffect(() => { if (data?.settings) setSound(data.settings.sound); }, [data?.settings?.sound]); // eslint-disable-line
  useStaffEvents({ 'kds:ticket': (p) => { if (sound && !p.status) beep(); reload(); }, 'order:updated': () => reload() }, reload);
  const tickets = (data?.data || []).filter((t: any) => !sel.length || sel.includes(t.station_id));
  const delay = data?.settings?.delayMinutes ?? 20;
  const update = async (id: number, status: 'preparing' | 'ready') => { await run(() => api(`/r/kitchen/tickets/${id}/status`, { body: { status } })); reload(); };
  const cols: [string, string][] = [['new', 'New'], ['preparing', 'Preparing'], ['ready', 'Ready — awaiting service']];
  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <PageHead title="Kitchen display" subtitle={`${tickets.length} active ticket(s)`} actions={<>
        <div className="row" style={{ gap: 6 }}>{(stations.data?.data || []).map((s: any) => <button key={s.id} className={`chip ${sel.includes(s.id) ? 'active' : ''}`} onClick={() => setSel(sel.includes(s.id) ? sel.filter((x) => x !== s.id) : [...sel, s.id])}>{s.name}</button>)}{sel.length > 0 && <button className="btn btn-sm btn-ghost" onClick={() => setSel([])}>All stations</button>}</div>
        <button className="btn btn-ghost icon-btn" onClick={() => setSound(!sound)} aria-label={sound ? 'Mute alerts' : 'Unmute alerts'}>{sound ? <Volume2 size={17} /> : <VolumeX size={17} />}</button>
        <button className="btn btn-ghost icon-btn" onClick={() => document.documentElement.requestFullscreen?.()} aria-label="Full screen"><Maximize2 size={17} /></button>
      </>} />
      <div className="board">
        {cols.map(([st, label]) => {
          const col = tickets.filter((t: any) => t.status === st);
          return (
            <div key={st} className="board-col"><h3>{label}<span className="badge">{col.length}</span></h3>
              {col.length === 0 && <Empty title="Clear" />}
              {col.map((t: any) => {
                const mins = (now - new Date(t.created_at).getTime()) / 60000;
                const late = st !== 'ready' && mins > Math.max(delay, t.prep_estimate_minutes || 0);
                return (
                  <div key={t.id} className={`ticket ${late ? 'delayed' : ''} ${t.priority ? 'priority' : ''}`}>
                    <div className="row-between"><strong style={{ fontSize: 16 }}>{t.order_no}</strong><span className={`badge ${late ? 'badge-danger' : 'badge-info'}`}>{ago(t.created_at, now)}</span></div>
                    <div className="small muted">{t.table_name || titleCase(t.order_type)} · {t.station_name || 'Kitchen'}{t.is_addition ? ' · addition' : ''}</div>
                    <ul className="ticket-items">{t.items.map((i: any) => <li key={i.id}><span className="qty">{i.quantity}×</span>{i.name}{i.variant_name ? ` (${i.variant_name})` : ''}{i.addons?.length ? <div className="small muted">+ {i.addons.map((a: any) => a.name).join(', ')}</div> : null}{i.notes && <div className="small" style={{ color: 'var(--warning)' }}>“{i.notes}”</div>}</li>)}</ul>
                    {t.order_notes && <div className="small" style={{ color: 'var(--warning)' }}>Order note: {t.order_notes}</div>}
                    <div className="row mt-s">
                      {st === 'new' && <button className="btn btn-sm grow" onClick={() => update(t.id, 'preparing')}>Start</button>}
                      {st !== 'ready' && <button className="btn btn-sm btn-primary grow" onClick={() => update(t.id, 'ready')}>Ready</button>}
                      {st !== 'ready' && <button className="btn btn-sm btn-ghost" title="Toggle priority" onClick={async () => { await run(() => api(`/r/kitchen/tickets/${t.id}/priority`, { body: { priority: t.priority ? 0 : 5 } })); reload(); }}>{t.priority ? '★' : '☆'}</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
