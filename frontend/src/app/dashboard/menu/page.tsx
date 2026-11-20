'use client';
import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi, useDebounced } from '@/lib/hooks';
import { money } from '@/lib/format';
import { useSession } from '@/components/Session';
import { useOptions } from '@/components/ResourcePage';
import { ConfirmButton, Drawer, Empty, PageHead, Skeleton, useAction } from '@/components/ui';

const blank = { name: '', category_id: '', price: '', description: '', prep_minutes: '', station_id: '', allergens: '', ingredients_text: '', is_featured: false, online_enabled: true, available: true, sort_order: 0, image_file_id: null as number | null };

function ItemEditor({ id, onClose, onSaved }: { id: number | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const s = useSession();
  const cats = useOptions('/r/categories');
  const stations = useOptions('/r/stations');
  const full = useApi<any>(typeof id === 'number' ? `/r/items/${id}/full` : null);
  const [f, setF] = useState<any>(blank);
  const [img, setImg] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<any>(null);
  const [v, setV] = useState({ name: '', price_delta: '0' });
  const [a, setA] = useState({ name: '', price: '0' });
  const [run, busy] = useAction();
  const d = full.data?.data;
  if (id !== loadedFor && (id === 'new' || d)) {
    setLoadedFor(id);
    if (id === 'new') { setF(blank); setImg(null); }
    else if (d) { setF({ ...blank, ...Object.fromEntries(Object.keys(blank).map((k) => [k, d[k] ?? (blank as any)[k]])), is_featured: !!d.is_featured, online_enabled: !!d.online_enabled, available: !!d.available }); setImg(d.imageUrl); }
  }
  const save = async () => {
    const body: any = { name: f.name, category_id: Number(f.category_id), price: String(f.price), description: f.description || null, prep_minutes: f.prep_minutes === '' || f.prep_minutes === null ? null : Number(f.prep_minutes), station_id: f.station_id ? Number(f.station_id) : null, allergens: f.allergens || null, ingredients_text: f.ingredients_text || null, is_featured: !!f.is_featured, online_enabled: !!f.online_enabled, available: !!f.available, sort_order: Number(f.sort_order) || 0, image_file_id: f.image_file_id || null };
    const r = await run(() => (id === 'new' ? api('/r/items', { body }) : api(`/r/items/${id}`, { method: 'PATCH', body })), 'Saved');
    if (r) { onSaved(); if (id === 'new') onClose(); else full.reload(); }
  };
  const upload = async (file: File) => { const fd = new FormData(); fd.append('file', file); const r = await run(() => api('/r/uploads/menu-images', { form: fd }), 'Image uploaded'); if (r) { setF({ ...f, image_file_id: r.data.id }); setImg(r.data.url); } };
  return (
    <Drawer open={id !== null} title={id === 'new' ? 'New menu item' : d?.name || 'Menu item'} onClose={onClose}
      footer={<>{typeof id === 'number' && <ConfirmButton label="Delete" confirm="Remove this item from the menu?" onConfirm={async () => { await run(() => api(`/r/items/${id}`, { method: 'DELETE' }), 'Removed'); onSaved(); onClose(); }} className="btn" />}<span className="grow" /><button className="btn btn-primary" disabled={busy || !f.name || !f.category_id || f.price === ''} onClick={save}>Save</button></>}>
      <div className="form-grid">
        <div className="full row">
          {img ? <img src={img} alt="" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 10 }} /> : <div style={{ width: 96, height: 96, borderRadius: 10, background: 'var(--surface-2)' }} />}
          <label className="btn" style={{ cursor: 'pointer' }}>Upload photo<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} /></label>
          <span className="tiny muted">JPEG/PNG/WebP, min 200 px. Auto-compressed.</span>
        </div>
        <label className="field">Name *<input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="field">Category *<select className="input" value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}><option value="">—</option>{cats.map((c: any) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
        <label className="field">Price ({s.currency}) *<input className="input" type="number" min="0" step="0.0001" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></label>
        <label className="field">Prep time (min)<input className="input" type="number" min="0" value={f.prep_minutes ?? ''} onChange={(e) => setF({ ...f, prep_minutes: e.target.value })} placeholder="Category default" /></label>
        <label className="field">Kitchen station<select className="input" value={f.station_id ?? ''} onChange={(e) => setF({ ...f, station_id: e.target.value })}><option value="">Category default</option>{stations.map((c: any) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>
        <label className="field">Sort order<input className="input" type="number" value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: e.target.value })} /></label>
        <label className="field full">Description<textarea className="input" value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <label className="field">Allergens<input className="input" value={f.allergens ?? ''} onChange={(e) => setF({ ...f, allergens: e.target.value })} placeholder="gluten, dairy, nuts" /></label>
        <label className="field">Ingredients (shown to guests)<input className="input" value={f.ingredients_text ?? ''} onChange={(e) => setF({ ...f, ingredients_text: e.target.value })} /></label>
        <div className="full row"><label className="check"><input type="checkbox" checked={f.available} onChange={(e) => setF({ ...f, available: e.target.checked })} />Available</label><label className="check"><input type="checkbox" checked={f.online_enabled} onChange={(e) => setF({ ...f, online_enabled: e.target.checked })} />Online ordering</label><label className="check"><input type="checkbox" checked={f.is_featured} onChange={(e) => setF({ ...f, is_featured: e.target.checked })} />Featured</label></div>
      </div>
      {d && <>
        <div className="section-title">Variants / sizes</div>
        {d.variants.map((x: any) => <div key={x.id} className="row-between small" style={{ padding: '4px 0' }}><span>{x.name}{x.is_default ? ' (default)' : ''} · {Number(x.price_delta) >= 0 ? '+' : ''}{money(x.price_delta, s.currency)}</span><button className="btn btn-sm btn-ghost" onClick={async () => { await run(() => api(`/r/items/${d.id}/variants/${x.id}`, { method: 'DELETE' })); full.reload(); }}>Remove</button></div>)}
        <div className="row"><input className="input grow" placeholder="e.g. Large" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /><input className="input" style={{ width: 110 }} type="number" step="0.01" value={v.price_delta} onChange={(e) => setV({ ...v, price_delta: e.target.value })} aria-label="Price difference" /><button className="btn" disabled={!v.name} onClick={async () => { await run(() => api(`/r/items/${d.id}/variants`, { body: { ...v, is_default: d.variants.length === 0 } })); setV({ name: '', price_delta: '0' }); full.reload(); }}>Add</button></div>
        <div className="section-title">Add-ons</div>
        {d.addons.map((x: any) => <div key={x.id} className="row-between small" style={{ padding: '4px 0' }}><span>{x.name} · +{money(x.price, s.currency)}</span><button className="btn btn-sm btn-ghost" onClick={async () => { await run(() => api(`/r/items/${d.id}/addons/${x.id}`, { method: 'DELETE' })); full.reload(); }}>Remove</button></div>)}
        <div className="row"><input className="input grow" placeholder="e.g. Extra cheese" value={a.name} onChange={(e) => setA({ ...a, name: e.target.value })} /><input className="input" style={{ width: 110 }} type="number" min="0" step="0.01" value={a.price} onChange={(e) => setA({ ...a, price: e.target.value })} aria-label="Add-on price" /><button className="btn" disabled={!a.name} onClick={async () => { await run(() => api(`/r/items/${d.id}/addons`, { body: a })); setA({ name: '', price: '0' }); full.reload(); }}>Add</button></div>
        <div className="section-title">Costing</div>
        <div className="small">{d.recipeCost ? <>Recipe cost {money(d.recipeCost, s.currency)} · margin {((1 - Number(d.recipeCost) / Number(d.price)) * 100).toFixed(1)}% · <a className="link" href={`/dashboard/recipes?item=${d.id}`}>Edit recipe</a></> : <>No recipe yet — <a className="link" href={`/dashboard/recipes?item=${d.id}`}>add one</a> to enable automatic stock deduction and food costing.</>}</div>
      </>}
    </Drawer>
  );
}

export default function MenuItems() {
  const s = useSession();
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('');
  const q = useDebounced(search);
  const cats = useOptions('/r/categories');
  const { data, loading, reload } = useApi<any>(`/r/items?pageSize=200${q ? `&search=${encodeURIComponent(q)}` : ''}${cat ? `&category_id=${cat}` : ''}`);
  const [edit, setEdit] = useState<number | 'new' | null>(null);
  const [run] = useAction();
  return (
    <div className="page">
      <PageHead title="Menu items" subtitle="Changes appear on QR, POS and online menus immediately." actions={<button className="btn btn-primary" onClick={() => setEdit('new')}><Plus size={16} /> New item</button>} />
      <div className="row mb"><div style={{ position: 'relative', width: 260 }}><Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--muted)' }} /><input className="input" style={{ paddingLeft: 32 }} placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <select className="input" style={{ width: 200 }} value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category"><option value="">All categories</option>{cats.map((c: any) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></div>
      {loading && !data ? <Skeleton /> : !data?.data.length ? <Empty title="No menu items">Create categories first, then add items.</Empty> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Item</th><th>Category</th><th className="num">Price</th><th>Online</th><th>Available</th></tr></thead>
          <tbody>{data.data.map((i: any) => (
            <tr key={i.id} className="clickable" onClick={() => setEdit(i.id)}>
              <td><strong>{i.name}</strong>{i.is_featured ? <span className="badge badge-brand" style={{ marginLeft: 6 }}>Featured</span> : null}</td>
              <td>{cats.find((c: any) => c.value === i.category_id)?.label || '—'}</td><td className="num">{money(i.price, s.currency)}</td><td>{i.online_enabled ? 'Yes' : 'No'}</td>
              <td onClick={(e) => e.stopPropagation()}><label className="check"><input type="checkbox" checked={!!i.available} onChange={async (e) => { await run(() => api(`/r/items/${i.id}/availability`, { body: { available: e.target.checked } }), e.target.checked ? 'Available' : 'Marked unavailable'); reload(); }} />{i.available ? 'On' : 'Off'}</label></td>
            </tr>))}</tbody></table></div>
      )}
      <ItemEditor id={edit} onClose={() => setEdit(null)} onSaved={reload} />
    </div>
  );
}
