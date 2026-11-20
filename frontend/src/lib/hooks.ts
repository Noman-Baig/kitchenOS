'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

/** Minimal data hook: fetch + refetch + loading/error; aborts stale requests. */
export function useApi<T = any>(path: string | null, opts: { customer?: boolean; interval?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(!!path);
  const ctrl = useRef<AbortController | null>(null);
  const load = useCallback(async (silent = false) => {
    if (!path) return;
    ctrl.current?.abort();
    const c = new AbortController(); ctrl.current = c;
    if (!silent) setLoading(true);
    try { const r = await api<T>(path, { customer: opts.customer, signal: c.signal }); setData(r); setError(null); }
    catch (e: any) { if (e.name !== 'AbortError') setError(e); }
    finally { if (!c.signal.aborted) setLoading(false); }
  }, [path, opts.customer]);
  useEffect(() => { void load(); return () => ctrl.current?.abort(); }, [load]);
  useEffect(() => {
    if (!opts.interval) return;
    const t = setInterval(() => void load(true), opts.interval);
    return () => clearInterval(t);
  }, [load, opts.interval]);
  return { data, error, loading, reload: () => load(true), setData };
}

export function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
}

export function useNow(ms = 1000) {
  const [n, setN] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setN(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return n;
}
