'use client';
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { money } from '@/lib/format';
import { Modal } from './ui';

export type CartLine = { key: string; itemId: number; name: string; variantId: number | null; variantName?: string | null; addonIds: number[]; addonNames: string[]; unit: number; quantity: number; notes?: string; complimentary?: boolean };

/** Item options (variant, add-ons, notes) shared by POS, waiter and customer menus. */
export function ItemOptions({ item, currency, onAdd, onClose, allowComp }: { item: any; currency: string; onAdd: (l: CartLine) => void; onClose: () => void; allowComp?: boolean }) {
  const def = item.variants?.find((v: any) => v.isDefault) || item.variants?.[0];
  const [variant, setVariant] = useState<number | null>(def?.id ?? null);
  const [addons, setAddons] = useState<number[]>([]);
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  const [comp, setComp] = useState(false);
  const v = item.variants?.find((x: any) => x.id === variant);
  const unit = Number(item.price) + Number(v?.priceDelta || 0) + addons.reduce((s, id) => s + Number(item.addons.find((a: any) => a.id === id)?.price || 0), 0);
  return (
    <Modal open title={item.name} onClose={onClose}>
      {item.imageUrl && <img src={item.imageUrl} alt="" style={{ width: '100%', height: 180, objectFit: 'cover', borderRadius: 10, marginBottom: 12 }} />}
      {item.description && <p className="muted">{item.description}</p>}
      {item.allergens && <p className="small"><strong>Allergens:</strong> {item.allergens}</p>}
      {item.variants?.length > 0 && <div className="mb"><div className="section-title">Size / variant</div><div className="row">{item.variants.map((x: any) => <button key={x.id} type="button" className={`chip ${variant === x.id ? 'active' : ''}`} onClick={() => setVariant(x.id)}>{x.name}{Number(x.priceDelta) ? ` (+${money(x.priceDelta, currency)})` : ''}</button>)}</div></div>}
      {item.addons?.length > 0 && <div className="mb"><div className="section-title">Add-ons</div><div className="stack" style={{ gap: 6 }}>{item.addons.map((a: any) => <label key={a.id} className="check"><input type="checkbox" checked={addons.includes(a.id)} onChange={(e) => setAddons(e.target.checked ? [...addons, a.id] : addons.filter((x) => x !== a.id))} />{a.name} <span className="muted">+{money(a.price, currency)}</span></label>)}</div></div>}
      <label className="field mb">Special instructions<input className="input" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. no onions" /></label>
      {allowComp && <label className="check mb"><input type="checkbox" checked={comp} onChange={(e) => setComp(e.target.checked)} /> Complimentary (no charge)</label>}
      <div className="row-between">
        <div className="qty"><button type="button" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Decrease">−</button><span>{qty}</span><button type="button" onClick={() => setQty(Math.min(99, qty + 1))} aria-label="Increase">+</button></div>
        <button className="btn btn-primary" onClick={() => { onAdd({ key: `${item.id}-${variant}-${addons.sort().join('.')}-${notes}-${comp}-${Date.now()}`, itemId: item.id, name: item.name, variantId: variant, variantName: v?.name, addonIds: addons, addonNames: addons.map((id) => item.addons.find((a: any) => a.id === id)?.name), unit: comp ? 0 : unit, quantity: qty, notes: notes || undefined, complimentary: comp }); onClose(); }}>Add · {money(comp ? 0 : unit * qty, currency)}</button>
      </div>
    </Modal>
  );
}

export function MenuGrid({ menu, currency, onPick }: { menu: any; currency: string; onPick: (item: any) => void }) {
  const [cat, setCat] = useState<number | 'all'>('all');
  const [q, setQ] = useState('');
  const items = useMemo(() => {
    const all = (menu?.categories || []).flatMap((c: any) => c.items.map((i: any) => ({ ...i, categoryId: c.id })));
    return all.filter((i: any) => (cat === 'all' || i.categoryId === cat) && (!q || i.name.toLowerCase().includes(q.toLowerCase())));
  }, [menu, cat, q]);
  return (
    <div>
      <div className="row mb">
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}><Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--muted)' }} /><input className="input" style={{ paddingLeft: 32 }} placeholder="Search items…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Search items" /></div>
      </div>
      <div className="row mb" style={{ gap: 6 }}><button className={`chip ${cat === 'all' ? 'active' : ''}`} onClick={() => setCat('all')}>All</button>{(menu?.categories || []).map((c: any) => <button key={c.id} className={`chip ${cat === c.id ? 'active' : ''}`} onClick={() => setCat(c.id)}>{c.name}</button>)}</div>
      <div className="pos-items">
        {items.map((i: any) => (
          <button key={i.id} className={`pos-item ${i.available ? '' : 'unavailable'}`} disabled={!i.available} onClick={() => onPick(i)} title={i.available ? i.name : `${i.name} (unavailable)`}>
            {i.thumbUrl && <img src={i.thumbUrl} alt="" loading="lazy" />}
            <strong style={{ fontSize: 13.5 }}>{i.name}</strong>
            <span className="small muted">{money(i.price, currency)}{!i.available ? ' · unavailable' : ''}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export const toApiLines = (lines: CartLine[]) => lines.map((l) => ({ itemId: l.itemId, variantId: l.variantId, addonIds: l.addonIds, quantity: l.quantity, notes: l.notes || null, complimentary: l.complimentary || undefined }));
