'use client';
import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { money } from '@/lib/format';
import { useSession } from '@/components/Session';
import { Empty, PageHead, useAction } from '@/components/ui';

export default function Recipes() {
  const s = useSession();
  const items = useApi<any>('/r/items?pageSize=200');
  const ingredients = useApi<any>('/r/ingredients?pageSize=200');
  const [itemId, setItemId] = useState<string>('');
  const [variantId, setVariantId] = useState<string>('');
  const full = useApi<any>(itemId ? `/r/items/${itemId}/full` : null);
  const rec = useApi<any>(itemId ? `/r/recipes/${itemId}${variantId ? `?variantId=${variantId}` : ''}` : null);
  const [lines, setLines] = useState<{ ingredientId: number; quantity: string; isOptional: boolean }[]>([]);
  const [yieldQty, setYield] = useState('1');
  const [wastage, setWastage] = useState('0');
  const [run, busy] = useAction();
  useEffect(() => { const p = new URLSearchParams(location.search).get('item'); if (p) setItemId(p); }, []);
  useEffect(() => {
    const d = rec.data?.data; if (!d) return;
    setLines(d.lines.map((l: any) => ({ ingredientId: l.ingredient_id, quantity: String(Number(l.quantity)), isOptional: !!l.is_optional })));
    setYield(d.recipe ? String(Number(d.recipe.yield_qty)) : '1'); setWastage(d.recipe ? String(Number(d.recipe.wastage_pct)) : '0');
  }, [rec.data]);
  const ing = (id: number) => (ingredients.data?.data || []).find((i: any) => i.id === id);
  const est = lines.reduce((a, l) => a + Number(l.quantity || 0) * Number(ing(l.ingredientId)?.avg_cost || 0), 0) * (1 + Number(wastage || 0) / 100) / Math.max(Number(yieldQty || 1), 0.0001);
  const price = Number(rec.data?.data?.item?.price || 0) + Number((full.data?.data?.variants || []).find((v: any) => String(v.id) === variantId)?.price_delta || 0);
  return (
    <div className="page" style={{ maxWidth: 980 }}>
      <PageHead title="Recipes & costing" subtitle="Ingredient quantities per portion drive automatic stock deduction and food-cost analytics." />
      <div className="row mb">
        <select className="input" style={{ width: 280 }} value={itemId} onChange={(e) => { setItemId(e.target.value); setVariantId(''); }} aria-label="Menu item"><option value="">Choose a menu item…</option>{(items.data?.data || []).map((i: any) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
        {(full.data?.data?.variants || []).length > 0 && <select className="input" style={{ width: 200 }} value={variantId} onChange={(e) => setVariantId(e.target.value)} aria-label="Variant"><option value="">All variants (base recipe)</option>{full.data.data.variants.map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>}
      </div>
      {!itemId ? <Empty title="Select a menu item" /> : (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)' }}>
          <div className="card">
            <div className="table-wrap"><table className="table"><thead><tr><th>Ingredient</th><th>Qty per batch</th><th>Optional</th><th className="num">Cost</th><th /></tr></thead>
              <tbody>{lines.map((l, i) => (
                <tr key={i}>
                  <td><select className="input" value={l.ingredientId} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, ingredientId: Number(e.target.value) } : x))}>{(ingredients.data?.data || []).map((g: any) => <option key={g.id} value={g.id}>{g.name} ({g.unit})</option>)}</select></td>
                  <td><input className="input" style={{ width: 110 }} type="number" min="0" step="0.0001" value={l.quantity} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x))} /></td>
                  <td><input type="checkbox" checked={l.isOptional} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, isOptional: e.target.checked } : x))} aria-label="Optional" /></td>
                  <td className="num">{money(Number(l.quantity || 0) * Number(ing(l.ingredientId)?.avg_cost || 0), s.currency)}</td>
                  <td><button className="btn btn-ghost icon-btn" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove"><Trash2 size={15} /></button></td>
                </tr>))}</tbody></table></div>
            <button className="btn mt-s" disabled={!(ingredients.data?.data || []).length} onClick={() => setLines([...lines, { ingredientId: ingredients.data.data[0].id, quantity: '0', isOptional: false }])}>+ Add ingredient</button>
            {!(ingredients.data?.data || []).length && <p className="small muted mt-s">Add stock items under Inventory first.</p>}
            <div className="form-grid mt"><label className="field">Batch yield (portions)<input className="input" type="number" min="0.0001" step="0.0001" value={yieldQty} onChange={(e) => setYield(e.target.value)} /></label><label className="field">Wastage allowance %<input className="input" type="number" min="0" step="0.1" value={wastage} onChange={(e) => setWastage(e.target.value)} /></label></div>
            <button className="btn btn-primary mt" disabled={busy} onClick={async () => { await run(() => api(`/r/recipes/${itemId}`, { method: 'PUT', body: { variantId: variantId ? Number(variantId) : null, yieldQty, wastagePct: wastage || '0', lines: lines.filter((l) => Number(l.quantity) > 0) } }), 'Recipe saved'); rec.reload(); }}>Save recipe</button>
          </div>
          <div className="card stack">
            <h3>Costing</h3>
            <div className="row-between"><span className="muted">Selling price</span><strong>{money(price, s.currency)}</strong></div>
            <div className="row-between"><span className="muted">Cost per portion (est.)</span><strong>{money(est, s.currency)}</strong></div>
            <div className="row-between"><span className="muted">Gross profit</span><strong>{money(price - est, s.currency)}</strong></div>
            <div className="row-between"><span className="muted">Food cost %</span><strong style={{ color: price && est / price > 0.35 ? 'var(--danger)' : undefined }}>{price ? ((est / price) * 100).toFixed(1) : '—'}%</strong></div>
            <p className="tiny muted">Estimate uses weighted-average ingredient cost. Actual food cost (from real consumption) is in Reports → Food cost.</p>
          </div>
        </div>
      )}
    </div>
  );
}
