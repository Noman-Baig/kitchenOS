'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { X, Inbox } from 'lucide-react';
import { titleCase } from '@/lib/format';

/* ---------------- Toasts ---------------- */
type Toast = { id: number; text: string; kind: 'ok' | 'error' };
const ToastCtx = createContext<(text: string, kind?: 'ok' | 'error') => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, kind }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">{items.map((t) => <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>{t.text}</div>)}</div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** Wraps an async action with toast feedback; returns [run, busy]. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    setBusy(true);
    try { const r = await fn(); if (ok) toast(ok); return r; }
    catch (e: any) {
      const details = e?.details?.fieldErrors ? Object.entries(e.details.fieldErrors).map(([k, v]: any) => `${k}: ${v.join(', ')}`).join('; ') : '';
      toast(`${e?.message || 'Something went wrong'}${details ? ' — ' + details : ''}`, 'error');
      return undefined;
    } finally { setBusy(false); }
  }, [toast]);
  return [run, busy] as const;
}

/* ---------------- Overlays ---------------- */
export function Drawer({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-head"><h2 style={{ margin: 0 }}>{title}</h2><button className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
    </div>
  );
}

export function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row-between mb"><h2 style={{ margin: 0 }}>{title}</h2><button className="btn btn-ghost icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        {children}
      </div>
    </div>
  );
}

/** Confirmation only for destructive actions; optional reason prompt. */
export function ConfirmButton({ label, confirm, onConfirm, danger = true, reason, className = 'btn btn-sm', disabled }: { label: ReactNode; confirm: string; onConfirm: (reason?: string) => Promise<unknown> | void; danger?: boolean; reason?: string; className?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button type="button" className={`${className} ${danger ? 'btn-danger' : ''}`} onClick={() => setOpen(true)} disabled={disabled}>{label}</button>
      <Modal open={open} title="Please confirm" onClose={() => setOpen(false)}>
        <p>{confirm}</p>
        {reason && <label className="field mb">{reason}<textarea className="input" value={text} onChange={(e) => setText(e.target.value)} /></label>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
          <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy || (!!reason && text.trim().length < 2)} onClick={async () => { setBusy(true); try { await onConfirm(reason ? text.trim() : undefined); setOpen(false); setText(''); } finally { setBusy(false); } }}>Confirm</button>
        </div>
      </Modal>
    </>
  );
}

/* ---------------- Display ---------------- */
const STATUS_KIND: Record<string, string> = {
  active: 'success', approved: 'success', paid: 'success', completed: 'success', served: 'success', ready: 'success', confirmed: 'success', cash_collected: 'success', verified: 'success', resolved: 'success', closed: 'muted', arrived: 'success', seated: 'success', success: 'success', ok: 'success',
  pending: 'warning', pending_approval: 'warning', under_review: 'warning', cash_requested: 'warning', partially_paid: 'warning', requested: 'warning', grace: 'warning', preparing: 'info', accepted: 'info', new: 'info', submitted: 'warning', open: 'info', waiting: 'warning', assigned: 'info', in_progress: 'info', acknowledged: 'info', ringing: 'warning', running: 'info', draft: 'muted', unpaid: 'warning',
  rejected: 'danger', cancelled: 'danger', suspended: 'danger', expired: 'danger', failed: 'danger', void: 'danger', refunded: 'danger', missed: 'danger', no_show: 'danger', low: 'danger', deleted: 'danger',
};
export function Status({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="muted">—</span>;
  const k = STATUS_KIND[value] || 'muted';
  return <span className={`badge ${k === 'muted' ? '' : 'badge-' + k}`}>{titleCase(value)}</span>;
}
export function Empty({ title = 'Nothing here yet', children }: { title?: string; children?: ReactNode }) {
  return <div className="empty"><Inbox size={30} /><div style={{ fontWeight: 600, color: 'var(--text)' }}>{title}</div>{children && <div className="small mt-s">{children}</div>}</div>;
}
export function Skeleton({ rows = 4 }: { rows?: number }) {
  return <div className="stack" aria-busy="true">{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton" style={{ width: `${90 - i * 9}%` }} />)}</div>;
}
export function ErrorState({ error, retry }: { error: Error; retry?: () => void }) {
  return <div className="alert alert-danger row-between"><span>{error.message}</span>{retry && <button className="btn btn-sm" onClick={retry}>Retry</button>}</div>;
}
export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return <div className="page-head"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{actions && <div className="row">{actions}</div>}</div>;
}
export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return <div className="card stat"><div className="label">{label}</div><div className="value">{value}</div>{sub && <div className="small muted">{sub}</div>}</div>;
}
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string; count?: number }[] }) {
  return <div className="tabs" role="tablist">{items.map((i) => <button key={i.value} role="tab" aria-selected={value === i.value} className={`tab ${value === i.value ? 'active' : ''}`} onClick={() => onChange(i.value)}>{i.label}{i.count !== undefined ? <span className="badge" style={{ marginLeft: 6 }}>{i.count}</span> : null}</button>)}</div>;
}

export const PRESETS = [
  ['today', 'Today'], ['yesterday', 'Yesterday'], ['this_week', 'This week'], ['last_week', 'Last week'], ['this_month', 'This month'], ['last_month', 'Last month'], ['custom', 'Custom'],
] as const;
export function DateFilter({ value, onChange }: { value: { preset: string; from?: string; to?: string }; onChange: (v: { preset: string; from?: string; to?: string }) => void }) {
  return (
    <div className="row">
      <select className="input" style={{ width: 150 }} value={value.preset} onChange={(e) => onChange({ ...value, preset: e.target.value })} aria-label="Date range">
        {PRESETS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {value.preset === 'custom' && <>
        <input type="date" className="input" style={{ width: 150 }} value={value.from || ''} onChange={(e) => onChange({ ...value, from: e.target.value })} aria-label="From" />
        <input type="date" className="input" style={{ width: 150 }} value={value.to || ''} onChange={(e) => onChange({ ...value, to: e.target.value })} aria-label="To" />
      </>}
    </div>
  );
}
export const rangeQuery = (v: { preset: string; from?: string; to?: string }) => (v.preset === 'custom' ? (v.from && v.to ? `preset=custom&from=${v.from}&to=${v.to}` : 'preset=today') : `preset=${v.preset}`);
