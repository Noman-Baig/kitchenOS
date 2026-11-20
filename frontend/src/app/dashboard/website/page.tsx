'use client';
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { titleCase } from '@/lib/format';
import { useSession } from '@/components/Session';
import { PageHead, Skeleton, useAction } from '@/components/ui';

const TEMPLATES = [['modern', 'Modern'], ['classic', 'Classic'], ['bistro', 'Bistro'], ['minimal', 'Minimal']];
const PALETTES: Record<string, any> = { modern: { primary: '#0F766E', accent: '#F59E0B', background: '#FFFFFF', text: '#111827' }, classic: { primary: '#7F1D1D', accent: '#B45309', background: '#FFFBF5', text: '#1C1917' }, bistro: { primary: '#14532D', accent: '#CA8A04', background: '#F7F5EF', text: '#1A2E05' }, minimal: { primary: '#111111', accent: '#555555', background: '#FFFFFF', text: '#111111' } };

export default function Website() {
  const s = useSession();
  const { data } = useApi<any>('/r/website');
  const [t, setT] = useState<any>(null);
  const [run, busy] = useAction();
  const [frameKey, setFrameKey] = useState(0);
  useEffect(() => { if (data) setT(data.data.draft); }, [data]);
  if (!t) return <div className="page"><Skeleton rows={8} /></div>;
  const setSec = (i: number, patch: any) => setT({ ...t, sections: t.sections.map((x: any, j: number) => (j === i ? { ...x, ...patch } : x)) });
  const move = (i: number, d: number) => { const a = [...t.sections]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setT({ ...t, sections: a }); };
  const saveDraft = async () => { const r = await run(() => api('/r/website/draft', { method: 'PUT', body: t }), 'Draft saved'); if (r) setFrameKey(frameKey + 1); return r; };
  const uploadGallery = async (i: number, file: File) => { const fd = new FormData(); fd.append('file', file); const r = await run(() => api('/r/uploads/gallery', { form: fd })); if (r) setSec(i, { images: [...(t.sections[i].images || []), r.data.url] }); };
  const banner = async (file: File) => { const fd = new FormData(); fd.append('file', file); await run(() => api('/r/uploads/restaurant-banners?setAsBanner=1', { form: fd }), 'Banner updated'); setFrameKey(frameKey + 1); };
  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <PageHead title="Website & theme" subtitle="Edit, preview the draft, then publish. Your public site and online ordering page use the published version." actions={<>
        <a className="btn" href={`/r/${s.restaurant?.slug}`} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Live site</a>
        <button className="btn" disabled={busy} onClick={saveDraft}>Save draft</button>
        <button className="btn btn-primary" disabled={busy} onClick={async () => { if (await saveDraft()) await run(() => api('/r/website/publish', { body: {} }), 'Published'); }}>Publish</button></>} />
      <div className="grid" style={{ gridTemplateColumns: 'minmax(320px, 420px) minmax(0,1fr)', alignItems: 'start' }}>
        <div className="stack">
          <div className="card stack">
            <h3>Theme</h3>
            <div className="row">{TEMPLATES.map(([k, l]) => <button key={k} className={`chip ${t.template === k ? 'active' : ''}`} onClick={() => setT({ ...t, template: k, colors: PALETTES[k] })}>{l}</button>)}</div>
            <div className="grid grid-2">{['primary', 'accent', 'background', 'text'].map((c) => <label key={c} className="field">{titleCase(c)}<input className="input" type="color" value={t.colors[c]} onChange={(e) => setT({ ...t, colors: { ...t.colors, [c]: e.target.value.toUpperCase() } })} style={{ padding: 2 }} /></label>)}</div>
            <div className="grid grid-2">
              <label className="field">Font<select className="input" value={t.font} onChange={(e) => setT({ ...t, font: e.target.value })}><option value="inter">Sans</option><option value="serif">Serif</option><option value="rounded">Rounded</option><option value="system">System</option></select></label>
              <label className="field">Buttons<select className="input" value={t.buttonStyle} onChange={(e) => setT({ ...t, buttonStyle: e.target.value })}><option value="rounded">Rounded</option><option value="pill">Pill</option><option value="square">Square</option></select></label>
              <label className="field">Header<select className="input" value={t.headerStyle} onChange={(e) => setT({ ...t, headerStyle: e.target.value })}><option value="logo-left">Logo left</option><option value="centered">Centered</option><option value="banner">Large banner</option></select></label>
              <label className="field">Banner image<label className="btn" style={{ cursor: 'pointer' }}>Upload<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && banner(e.target.files[0])} /></label></label>
            </div>
          </div>
          <div className="card stack">
            <h3>Promotion banner</h3>
            <label className="check"><input type="checkbox" checked={!!t.promoBanner?.enabled} onChange={(e) => setT({ ...t, promoBanner: { ...(t.promoBanner || { text: '' }), enabled: e.target.checked } })} /> Show</label>
            <input className="input" placeholder="e.g. 20% off pickup orders this weekend" value={t.promoBanner?.text || ''} onChange={(e) => setT({ ...t, promoBanner: { ...(t.promoBanner || { enabled: true }), text: e.target.value } })} />
          </div>
          <div className="card stack">
            <h3>Sections</h3>
            {t.sections.map((sec: any, i: number) => (
              <div key={sec.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                <div className="row-between"><label className="check"><input type="checkbox" checked={sec.enabled} onChange={(e) => setSec(i, { enabled: e.target.checked })} /><strong>{titleCase(sec.type)}</strong></label><div className="row" style={{ gap: 2 }}><button className="btn btn-sm btn-ghost icon-btn" onClick={() => move(i, -1)} aria-label="Move up"><ArrowUp size={14} /></button><button className="btn btn-sm btn-ghost icon-btn" onClick={() => move(i, 1)} aria-label="Move down"><ArrowDown size={14} /></button></div></div>
                {sec.enabled && <div className="stack mt-s" style={{ gap: 6 }}>
                  <input className="input" placeholder="Title" value={sec.title || ''} onChange={(e) => setSec(i, { title: e.target.value })} />
                  {['hero', 'about', 'promo'].includes(sec.type) && <textarea className="input" placeholder="Text" value={sec.body || ''} onChange={(e) => setSec(i, { body: e.target.value })} />}
                  {sec.type === 'gallery' && <><div className="row">{(sec.images || []).map((u: string) => <div key={u} style={{ position: 'relative' }}><img src={u} alt="" width={56} height={56} style={{ objectFit: 'cover', borderRadius: 6 }} /><button className="btn btn-sm btn-ghost" onClick={() => setSec(i, { images: sec.images.filter((x: string) => x !== u) })} aria-label="Remove image">×</button></div>)}</div><label className="btn btn-sm" style={{ cursor: 'pointer', alignSelf: 'flex-start' }}>Add photo<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && uploadGallery(i, e.target.files[0])} /></label></>}
                </div>}
              </div>
            ))}
          </div>
          <div className="card stack">
            <h3>Social & footer</h3>
            {['instagram', 'facebook', 'tiktok', 'x', 'whatsapp'].map((k) => <input key={k} className="input" placeholder={titleCase(k)} value={t.social?.[k] || ''} onChange={(e) => setT({ ...t, social: { ...t.social, [k]: e.target.value } })} />)}
            <input className="input" placeholder="Footer text" value={t.footerText || ''} onChange={(e) => setT({ ...t, footerText: e.target.value })} />
          </div>
        </div>
        <div className="card" style={{ padding: 0, overflow: 'hidden', position: 'sticky', top: 70 }}>
          <div className="row-between" style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}><span className="small muted">Draft preview (save draft to refresh)</span></div>
          <iframe key={frameKey} title="Website preview" src={`/r/${s.restaurant?.slug}?preview=1`} style={{ width: '100%', height: '78vh', border: 0, background: '#fff' }} />
        </div>
      </div>
    </div>
  );
}
