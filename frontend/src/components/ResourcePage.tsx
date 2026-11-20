'use client';
import { useMemo, useState, type ReactNode } from 'react';
import { Plus, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { useApi, useDebounced } from '@/lib/hooks';
import { ConfirmButton, Drawer, Empty, ErrorState, PageHead, Skeleton, useAction } from './ui';

export type Field = {
  name: string; label: string; type?: 'text' | 'number' | 'money' | 'textarea' | 'select' | 'multiselect' | 'checkbox' | 'date' | 'email' | 'datetime'; fromRow?: (row: any) => any;
  options?: { value: string | number; label: string }[] | (() => { value: string | number; label: string }[]);
  required?: boolean; hint?: string; full?: boolean; placeholder?: string; nullable?: boolean; createOnly?: boolean;
};
export type Column = { key: string; label: string; render?: (row: any) => ReactNode; className?: string };

/** Generic, fully wired CRUD screen for tenant-scoped resources (list, search, paginate, create, edit, delete). */
export function ResourcePage(p: {
  title: string; subtitle?: string; endpoint: string; fields: Field[]; columns: Column[]; canWrite?: boolean; searchable?: boolean;
  defaults?: Record<string, any>; deleteLabel?: string; extraActions?: (row: any, reload: () => void) => ReactNode; toolbar?: ReactNode; transform?: (d: Record<string, any>) => Record<string, any>;
  noDelete?: boolean; noCreate?: boolean;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const { data, error, loading, reload } = useApi<any>(`${p.endpoint}?page=${page}&pageSize=50${q ? `&search=${encodeURIComponent(q)}` : ''}`);
  const [edit, setEdit] = useState<any | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [run, busy] = useAction();
  const rows = data?.data ?? [];
  const totalPages = data?.total ? Math.max(1, Math.ceil(data.total / 50)) : 1;

  const openNew = () => { setForm({ ...(p.defaults || {}) }); setEdit({}); };
  const openEdit = (row: any) => { const f: Record<string, any> = {}; p.fields.forEach((fl) => { f[fl.name] = fl.fromRow ? fl.fromRow(row) : row[fl.name] ?? ''; }); setForm(f); setEdit(row); };
  const save = async () => {
    const out: Record<string, any> = {};
    for (const f of p.fields) {
      if (f.createOnly && edit?.id) continue;
      let v = form[f.name];
      if (f.type === 'checkbox') v = !!v;
      else if (f.type === 'multiselect') v = Array.isArray(v) ? v : [];
      else if (f.type === 'number') v = v === '' || v === null || v === undefined ? (f.nullable ? null : undefined) : Number(v);
      else if (f.type === 'select' && typeof v === 'string' && /^\d+$/.test(v) && typeof (opts(f)[0]?.value) === 'number') v = Number(v);
      else if (f.type === 'datetime') v = v ? new Date(v).toISOString() : (f.nullable ? null : undefined);
      else if (v === '') v = f.nullable ? null : undefined;
      if (v !== undefined) out[f.name] = v;
    }
    const body = p.transform ? p.transform(out) : out;
    const ok = await run(() => (edit?.id ? api(`${p.endpoint}/${edit.id}`, { method: 'PATCH', body }) : api(p.endpoint, { body })), 'Saved');
    if (ok) { setEdit(null); reload(); }
  };
  const opts = (f: Field) => (typeof f.options === 'function' ? f.options() : f.options || []);

  return (
    <div>
      <PageHead title={p.title} subtitle={p.subtitle} actions={<>{p.toolbar}{p.canWrite !== false && !p.noCreate && <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> New</button>}</>} />
      {p.searchable !== false && <div className="row mb"><div style={{ position: 'relative', width: 280 }}><Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--muted)' }} /><input className="input" style={{ paddingLeft: 32 }} placeholder="Search…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} aria-label="Search" /></div></div>}
      {error ? <ErrorState error={error} retry={reload} /> : loading && !data ? <div className="card"><Skeleton /></div> : !rows.length ? <div className="card"><Empty title={`No ${p.title.toLowerCase()} yet`}>{p.canWrite !== false && !p.noCreate ? 'Use “New” to add the first one.' : null}</Empty></div> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr>{p.columns.map((c) => <th key={c.key} className={c.className}>{c.label}</th>)}<th /></tr></thead>
            <tbody>{rows.map((r: any) => (
              <tr key={r.id} className={p.canWrite !== false ? 'clickable' : ''} onClick={() => p.canWrite !== false && openEdit(r)}>
                {p.columns.map((c) => <td key={c.key} className={c.className}>{c.render ? c.render(r) : String(r[c.key] ?? '—')}</td>)}
                <td className="right nowrap" onClick={(e) => e.stopPropagation()}>{p.extraActions?.(r, reload)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      {totalPages > 1 && <div className="row mt" style={{ justifyContent: 'flex-end' }}><button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span className="small muted">Page {page} of {totalPages}</span><button className="btn btn-sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button></div>}
      <Drawer open={!!edit} title={edit?.id ? `Edit ${p.title.replace(/s$/, '').toLowerCase()}` : `New ${p.title.replace(/s$/, '').toLowerCase()}`} onClose={() => setEdit(null)}
        footer={<>
          {edit?.id && !p.noDelete && <ConfirmButton label={p.deleteLabel || 'Delete'} confirm="This cannot be undone. Continue?" onConfirm={async () => { const ok = await run(() => api(`${p.endpoint}/${edit.id}`, { method: 'DELETE' }), 'Deleted'); if (ok) { setEdit(null); reload(); } }} className="btn" />}
          <span className="grow" /><button className="btn" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>Save</button>
        </>}>
        <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          {p.fields.filter((f) => !(f.createOnly && edit?.id)).map((f) => (
            <label key={f.name} className={`field ${f.full || f.type === 'textarea' ? 'full' : ''}`} style={f.type === 'checkbox' ? { flexDirection: 'row', alignItems: 'center' } : undefined}>
              {f.type === 'checkbox' ? <span className="check"><input type="checkbox" checked={!!form[f.name]} onChange={(e) => setForm({ ...form, [f.name]: e.target.checked })} />{f.label}</span> : <>{f.label}{f.required ? ' *' : ''}</>}
              {f.type === 'textarea' ? <textarea className="input" value={form[f.name] ?? ''} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })} placeholder={f.placeholder} />
                : f.type === 'multiselect' ? <div className="row" style={{ gap: 6 }}>{opts(f).map((o) => { const cur: any[] = Array.isArray(form[f.name]) ? form[f.name] : []; const on = cur.includes(o.value); return <button type="button" key={o.value} className={`chip ${on ? 'active' : ''}`} onClick={() => setForm({ ...form, [f.name]: on ? cur.filter((x) => x !== o.value) : [...cur, o.value] })}>{o.label}</button>; })}</div>
                : f.type === 'select' ? <select className="input" value={form[f.name] ?? ''} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })} required={f.required}><option value="">—</option>{opts(f).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                  : f.type === 'checkbox' ? null
                    : <input className="input" type={f.type === 'money' || f.type === 'number' ? 'number' : f.type === 'datetime' ? 'datetime-local' : f.type || 'text'} step={f.type === 'money' ? '0.0001' : f.type === 'number' ? 'any' : undefined} value={f.type === 'datetime' && form[f.name] ? String(form[f.name]).slice(0, 16) : form[f.name] ?? ''} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })} required={f.required} placeholder={f.placeholder} />}
              {f.hint && <span className="hint">{f.hint}</span>}
            </label>
          ))}
          <button type="submit" hidden />
        </form>
      </Drawer>
    </div>
  );
}

export function useOptions(endpoint: string, label = 'name') {
  const { data } = useApi<any>(`${endpoint}${endpoint.includes('?') ? '&' : '?'}pageSize=200`);
  return useMemo(() => (data?.data ?? []).map((r: any) => ({ value: r.id, label: r[label] })), [data, label]);
}
