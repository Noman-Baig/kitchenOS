'use client';
import { useState } from 'react';
import { ChefHat, LayoutDashboard, QrCode } from 'lucide-react';

/** Interactive preview of real product screens (illustrative sample data, rendered with the app's own components). */
export function ProductPreview() {
  const [tab, setTab] = useState<'dash' | 'kds' | 'menu'>('dash');
  return (
    <div className="preview" aria-label="Product preview">
      <div className="preview-bar"><i /><i /><i />
        <div className="segmented" style={{ marginLeft: 'auto' }}>
          <button className={tab === 'dash' ? 'active' : ''} onClick={() => setTab('dash')}><LayoutDashboard size={13} /> Dashboard</button>
          <button className={tab === 'kds' ? 'active' : ''} onClick={() => setTab('kds')}><ChefHat size={13} /> Kitchen</button>
          <button className={tab === 'menu' ? 'active' : ''} onClick={() => setTab('menu')}><QrCode size={13} /> Guest menu</button>
        </div>
      </div>
      <div style={{ padding: 18, minHeight: 330 }}>
        {tab === 'dash' && (
          <div className="stack">
            <div className="grid grid-4">
              {[['Today’s sales', '$4.8K'], ['Orders', '126'], ['Active tables', '14 / 22'], ['Avg. prep', '13.2 min']].map(([l, v]) => <div key={l} className="card card-tight stat"><div className="label">{l}</div><div className="value">{v}</div></div>)}
            </div>
            <div className="card card-tight">
              <div className="small muted mb">Revenue this week</div>
              <svg viewBox="0 0 300 80" width="100%" height="90" aria-hidden><polyline fill="none" stroke="var(--brand)" strokeWidth="2.5" points="0,60 50,52 100,58 150,35 200,40 250,22 300,18" /><polygon fill="var(--brand-soft)" points="0,80 0,60 50,52 100,58 150,35 200,40 250,22 300,18 300,80" /></svg>
            </div>
            <div className="row small"><span className="badge badge-warning">3 payments to review</span><span className="badge badge-danger">Low stock: Mozzarella</span><span className="badge badge-info">2 waiter requests</span></div>
          </div>
        )}
        {tab === 'kds' && (
          <div className="grid grid-3">
            {[['#041 · Table 6', '4m', ['2 × Margherita (Large)', '1 × Garlic bread — extra butter'], false], ['#042 · Pickup', '11m', ['1 × BBQ Chicken Pizza'], false], ['#039 · Table 2', '23m', ['3 × Pepperoni', 'Note: one without chili'], true]].map(([t, m, items, late]: any) => (
              <div key={t} className={`ticket ${late ? 'delayed' : ''}`}>
                <div className="row-between"><strong>{t}</strong><span className={`badge ${late ? 'badge-danger' : 'badge-info'}`}>{m}</span></div>
                <ul className="ticket-items">{items.map((i: string) => <li key={i}>{i}</li>)}</ul>
                <button className="btn btn-sm btn-primary btn-block" type="button">{late ? 'Mark ready' : 'Start'}</button>
              </div>
            ))}
          </div>
        )}
        {tab === 'menu' && (
          <div style={{ maxWidth: 360, margin: '0 auto', border: '1px solid var(--border)', borderRadius: 18, overflow: 'hidden' }}>
            <div style={{ padding: 14, borderBottom: '1px solid var(--border)' }}><strong>Welcome back, Sara!</strong><div className="small muted">Table 6 · Order in ~15 min</div></div>
            {[['Margherita', 'Tomato, mozzarella, basil', '$12.00'], ['BBQ Chicken', 'Smoky chicken, red onion', '$15.50'], ['Fresh lemonade', 'Squeezed to order', '$4.00']].map(([n, d, p]) => (
              <div key={n} className="menu-item" style={{ cursor: 'default' }}><div className="grow"><div className="name">{n}</div><div className="desc">{d}</div><div className="mt-s"><strong>{p}</strong></div></div><button className="btn btn-sm" type="button">Add</button></div>
            ))}
            <div style={{ padding: 12 }}><button className="btn btn-primary btn-block" type="button">View order · 2 items · $27.50</button></div>
          </div>
        )}
      </div>
    </div>
  );
}
