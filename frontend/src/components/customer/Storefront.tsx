'use client';
import { useCallback, useEffect, useState } from 'react';
import { Clock, MapPin, Phone, ShoppingBag } from 'lucide-react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { CustomerApp } from './CustomerApp';
import { Modal, useToast } from '../ui';

const FONTS: Record<string, string> = { inter: 'Inter, ui-sans-serif, system-ui, sans-serif', serif: 'Georgia, "Times New Roman", serif', rounded: '"Nunito", "Segoe UI Rounded", ui-rounded, system-ui, sans-serif', system: 'system-ui, sans-serif' };
const RADIUS: Record<string, string> = { rounded: '10px', pill: '999px', square: '2px' };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function Storefront({ slug, initial, menu, poweredBy }: { slug: string; initial: any; menu: any; poweredBy: string }) {
  const toast = useToast();
  const [r] = useState(initial);
  const [theme, setTheme] = useState<any>(initial.theme);
  const [token, setToken] = useState<string | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [f, setF] = useState({ name: '', phone: '', orderType: initial.ordering.pickup ? 'pickup' : 'delivery', marketingOptIn: false, recognitionOptIn: false });
  const [res, setRes] = useState({ customerName: '', phone: '', email: '', partySize: 2, date: '', time: '19:00', specialRequests: '' });
  const [busy, setBusy] = useState(false);
  const key = `um_cs_online_${slug}`;
  useEffect(() => {
    try { setToken(localStorage.getItem(key)); } catch { /* */ }
    if (new URLSearchParams(location.search).get('preview') === '1') api('/r/website').then((x) => setTheme(x.data.draft)).catch(() => undefined);
  }, [key]);
  const ended = useCallback(() => { try { localStorage.removeItem(key); } catch { /* */ } setToken(null); }, [key]);
  const t = theme || { colors: { primary: '#0F766E', accent: '#F59E0B', background: '#FFFFFF', text: '#111827' }, font: 'inter', buttonStyle: 'rounded', headerStyle: 'logo-left', sections: [{ type: 'hero', enabled: true, title: r.name }, { type: 'menu', enabled: true, title: 'Menu' }, { type: 'reservation', enabled: true, title: 'Book a table' }, { type: 'contact', enabled: true, title: 'Find us' }], navigation: [], social: {} };
  const style: any = { '--brand': t.colors.primary, background: t.colors.background, color: t.colors.text, fontFamily: FONTS[t.font] || FONTS.inter, minHeight: '100vh' };
  const btn = { borderRadius: RADIUS[t.buttonStyle] || '10px' };
  const canOrder = r.available && r.ordering.onlineOpen;
  const featured = (menu?.categories || []).flatMap((c: any) => c.items).filter((i: any) => i.featured).slice(0, 6);

  if (token) return <div style={style}><CustomerApp token={token} onEnded={ended} /><div className="no-print" style={{ position: 'fixed', top: 12, right: 12, zIndex: 50 }}><button className="btn btn-sm" onClick={() => setToken(null)}>Back to website</button></div></div>;

  const section = (s: any, i: number) => {
    if (!s.enabled) return null;
    switch (s.type) {
      case 'hero': return (
        <section key={i} className="sf-hero" style={{ backgroundImage: r.bannerUrl ? `url(${r.bannerUrl})` : undefined, background: r.bannerUrl ? undefined : t.colors.primary }}>
          <div className="container inner"><h1 style={{ fontSize: 'clamp(2rem,5vw,3.2rem)', color: '#fff' }}>{s.title || r.name}</h1>{s.body && <p style={{ maxWidth: 560, fontSize: 17, opacity: 0.92 }}>{s.body}</p>}
            <div className="row">{canOrder ? <button className="btn btn-lg btn-primary" style={btn} onClick={() => setOrderOpen(true)}><ShoppingBag size={17} /> Order online</button> : <span className="badge">{r.available ? 'Online ordering is closed right now' : 'Currently unavailable'}</span>}<a className="btn btn-lg" style={btn} href="#menu">View menu</a></div></div>
        </section>);
      case 'featured': return featured.length ? <section key={i} className="section"><div className="container"><h2>{s.title || 'Featured'}</h2><div className="grid grid-3">{featured.map((it: any) => <div key={it.id} className="card" style={{ padding: 0, overflow: 'hidden' }}>{it.imageUrl && <img src={it.imageUrl} alt={it.name} loading="lazy" style={{ width: '100%', height: 180, objectFit: 'cover' }} />}<div style={{ padding: 14 }}><strong>{it.name}</strong><div className="small muted">{it.description}</div><div className="mt-s"><strong>{money(it.price, r.currency, r.locale)}</strong></div></div></div>)}</div></div></section> : null;
      case 'menu': return (
        <section key={i} id="menu" className="section"><div className="container"><h2>{s.title || 'Menu'}</h2>
          {(menu?.categories || []).map((c: any) => <div key={c.id} className="mb"><h3 style={{ color: t.colors.primary }}>{c.name}</h3><div className="grid grid-2">{c.items.map((it: any) => <div key={it.id} className="row" style={{ alignItems: 'flex-start', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>{it.thumbUrl && <img src={it.thumbUrl} alt="" width={64} height={64} loading="lazy" style={{ borderRadius: 8, objectFit: 'cover' }} />}<div className="grow"><div className="row-between"><strong>{it.name}</strong><strong>{money(it.price, r.currency, r.locale)}</strong></div><div className="small muted">{it.description}</div>{it.allergens && <div className="tiny muted">Allergens: {it.allergens}</div>}{!it.available && <span className="badge">Unavailable today</span>}</div></div>)}</div></div>)}
          {canOrder && <button className="btn btn-primary btn-lg" style={btn} onClick={() => setOrderOpen(true)}>Start an order</button>}
        </div></section>);
      case 'about': return s.body ? <section key={i} id="about" className="section section-alt"><div className="container prose"><h2>{s.title || 'About us'}</h2><p style={{ whiteSpace: 'pre-wrap' }}>{s.body}</p></div></section> : null;
      case 'gallery': return s.images?.length ? <section key={i} className="section"><div className="container"><h2>{s.title || 'Gallery'}</h2><div className="grid grid-3">{s.images.map((u: string) => <img key={u} src={u} alt="" loading="lazy" style={{ width: '100%', height: 220, objectFit: 'cover', borderRadius: 10 }} />)}</div></div></section> : null;
      case 'reviews': return r.reviews?.length ? <section key={i} className="section section-alt"><div className="container"><h2>{s.title || 'What guests say'}</h2><div className="grid grid-3">{r.reviews.map((v: any, k: number) => <blockquote key={k} className="card" style={{ margin: 0 }}><div style={{ color: '#d97706' }}>{'★'.repeat(v.rating)}</div><p>{v.comment}</p><footer className="small muted">— {v.name}</footer></blockquote>)}</div></div></section> : null;
      case 'reservation': return (
        <section key={i} id="reserve" className="section"><div className="container" style={{ maxWidth: 640 }}><h2>{s.title || 'Book a table'}</h2>
          <form className="card form-grid" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await api(`/public/restaurants/${slug}/reservations`, { body: { customerName: res.customerName, phone: res.phone, email: res.email || null, partySize: Number(res.partySize), reservedFor: new Date(`${res.date}T${res.time}`).toISOString(), specialRequests: res.specialRequests || null } }); toast('Request sent — the restaurant will confirm your booking'); setRes({ ...res, specialRequests: '' }); } catch (x: any) { toast(x.message, 'error'); } finally { setBusy(false); } }}>
            <label className="field">Name<input className="input" required value={res.customerName} onChange={(e) => setRes({ ...res, customerName: e.target.value })} /></label>
            <label className="field">Phone<input className="input" required type="tel" value={res.phone} onChange={(e) => setRes({ ...res, phone: e.target.value })} /></label>
            <label className="field">Date<input className="input" required type="date" min={new Date().toISOString().slice(0, 10)} value={res.date} onChange={(e) => setRes({ ...res, date: e.target.value })} /></label>
            <label className="field">Time<input className="input" required type="time" value={res.time} onChange={(e) => setRes({ ...res, time: e.target.value })} /></label>
            <label className="field">Guests<input className="input" type="number" min={1} max={100} value={res.partySize} onChange={(e) => setRes({ ...res, partySize: Number(e.target.value) })} /></label>
            <label className="field">Email (optional)<input className="input" type="email" value={res.email} onChange={(e) => setRes({ ...res, email: e.target.value })} /></label>
            <label className="field full">Special requests<textarea className="input" value={res.specialRequests} onChange={(e) => setRes({ ...res, specialRequests: e.target.value })} /></label>
            <div className="full"><button className="btn btn-primary" style={btn} disabled={busy || !r.available}>Request reservation</button></div>
          </form></div></section>);
      case 'hours': return r.ordering.openingHours?.length ? <section key={i} className="section section-alt"><div className="container" style={{ maxWidth: 640 }}><h2>{s.title || 'Opening hours'}</h2>{r.ordering.openingHours.map((h: any, k: number) => <div key={k} className="row-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}><span><Clock size={14} /> {DAYS[h.day]}</span><span>{h.open} – {h.close}</span></div>)}</div></section> : null;
      case 'contact': return <section key={i} id="contact" className="section"><div className="container stack" style={{ maxWidth: 640 }}><h2>{s.title || 'Find us'}</h2>{r.address && <div className="row"><MapPin size={16} /> {r.address}{r.city ? `, ${r.city}` : ''}</div>}{r.phone && <a className="row" href={`tel:${r.phone}`}><Phone size={16} /> {r.phone}</a>}{r.email && <a className="link" href={`mailto:${r.email}`}>{r.email}</a>}<div className="row small">{Object.entries(t.social || {}).filter(([, v]) => v).map(([k, v]) => <a key={k} className="link" href={k === 'whatsapp' ? `https://wa.me/${String(v).replace(/\D/g, '')}` : String(v).startsWith('http') ? String(v) : `https://${v}`} target="_blank" rel="noreferrer noopener">{k}</a>)}</div></div></section>;
      case 'promo': return s.body ? <section key={i} className="section"><div className="container"><div className="card" style={{ background: t.colors.accent, color: '#fff' }}><h2>{s.title}</h2><p>{s.body}</p></div></div></section> : null;
      default: return null;
    }
  };

  return (
    <div style={style}>
      {t.promoBanner?.enabled && t.promoBanner.text && <div style={{ background: t.colors.accent, color: '#fff', textAlign: 'center', padding: '8px 12px', fontSize: 14 }}>{t.promoBanner.text}</div>}
      <header style={{ borderBottom: '1px solid rgba(0,0,0,.08)', position: 'sticky', top: 0, background: t.colors.background, zIndex: 20 }}>
        <div className="container row-between" style={{ height: 64, justifyContent: t.headerStyle === 'centered' ? 'center' : 'space-between' }}>
          <div className="row">{r.logoUrl && <img src={r.logoUrl} alt="" width={36} height={36} style={{ borderRadius: 8 }} />}<strong style={{ fontSize: 17 }}>{r.name}</strong></div>
          {t.headerStyle !== 'centered' && <nav className="row small" aria-label="Restaurant">{(t.navigation || []).map((n: any) => <a key={n.label} href={n.target}>{n.label}</a>)}{canOrder && <button className="btn btn-sm btn-primary" style={btn} onClick={() => setOrderOpen(true)}>Order</button>}</nav>}
        </div>
      </header>
      {!r.available && <div className="alert alert-warning" style={{ borderRadius: 0 }}>{r.suspension?.reason || 'This restaurant is not accepting online orders right now.'}</div>}
      <main>{(t.sections || []).map(section)}</main>
      <footer className="site-footer" style={{ borderColor: 'rgba(0,0,0,.08)' }}><div className="container row-between small"><span>{t.footerText || `© ${new Date().getFullYear()} ${r.name}`}</span><span className="muted">Powered by {poweredBy} · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></span></div></footer>
      <Modal open={orderOpen} title={`Order from ${r.name}`} onClose={() => setOrderOpen(false)}>
        <form className="stack" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { const x = await api(`/public/restaurants/${slug}/online-session`, { body: { name: f.name, phone: f.phone || null, orderType: f.orderType, marketingOptIn: f.marketingOptIn, recognitionOptIn: f.recognitionOptIn } }); try { localStorage.setItem(key, x.data.token); } catch { /* */ } setToken(x.data.token); setOrderOpen(false); } catch (er: any) { toast(er.message, 'error'); } finally { setBusy(false); } }}>
          <div className="segmented">{r.ordering.pickup && <button type="button" className={f.orderType === 'pickup' ? 'active' : ''} onClick={() => setF({ ...f, orderType: 'pickup' })}>Pickup</button>}{r.ordering.delivery && <button type="button" className={f.orderType === 'delivery' ? 'active' : ''} onClick={() => setF({ ...f, orderType: 'delivery' })}>Delivery{Number(r.ordering.deliveryCharge) > 0 ? ` (+${money(r.ordering.deliveryCharge, r.currency)})` : ''}</button>}</div>
          <label className="field">Your name<input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="field">Phone (recommended)<input className="input" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
          {f.phone && <><label className="check"><input type="checkbox" checked={f.recognitionOptIn} onChange={(e) => setF({ ...f, recognitionOptIn: e.target.checked })} /> Remember me next time</label><label className="check"><input type="checkbox" checked={f.marketingOptIn} onChange={(e) => setF({ ...f, marketingOptIn: e.target.checked })} /> Send me offers</label></>}
          {Number(r.ordering.minimumOrder) > 0 && <div className="small muted">Minimum order {money(r.ordering.minimumOrder, r.currency)}</div>}
          <button className="btn btn-primary btn-lg" style={btn} disabled={busy || !f.name}>Continue to menu</button>
        </form>
      </Modal>
    </div>
  );
}
